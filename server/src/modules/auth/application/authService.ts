import type { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { DomainError, ValidationError } from "../../../shared/errors.js";
import { hashPassword, verifyPassword } from "../infrastructure/password.js";
import { permissionsForRoles, ROLES, type Permission, type RoleCode } from "../domain/permissions.js";
import type { AuditContext, AuditService } from "../../audit/application/auditService.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: Permission[];
}

const TOKEN_TTL = "12h";
export const MIN_PASSWORD_LENGTH = 10;

function isRoleCode(value: string): value is RoleCode {
  return (ROLES as readonly string[]).includes(value);
}

function assertStrongEnough(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, {
      minLength: MIN_PASSWORD_LENGTH,
    });
  }
}

export class AuthService {
  constructor(
    private readonly db: PrismaClient,
    private readonly jwtSecret: string,
    private readonly audit: AuditService
  ) {}

  async login(email: string, password: string) {
    const user = await this.db.user.findUnique({
      where: { email },
      include: { roles: { include: { role: true } } },
    });

    // Same error for unknown user and bad password — do not confirm which
    // emails exist.
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new DomainError("INVALID_CREDENTIALS", "Invalid email or password", 401);
    }
    if (user.status !== "ACTIVE") {
      throw new DomainError("USER_DISABLED", "This account is disabled", 403);
    }

    const roles = user.roles.map((r) => r.role.code);
    const token = jwt.sign({ sub: user.id }, this.jwtSecret, { expiresIn: TOKEN_TTL });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles,
        permissions: [...permissionsForRoles(roles)],
      } satisfies AuthenticatedUser,
    };
  }

  async verifyToken(token: string): Promise<AuthenticatedUser> {
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, this.jwtSecret) as jwt.JwtPayload;
    } catch {
      throw new DomainError("INVALID_TOKEN", "Session token is invalid or expired", 401);
    }

    const user = await this.db.user.findUnique({
      where: { id: String(payload.sub) },
      include: { roles: { include: { role: true } } },
    });
    if (!user || user.status !== "ACTIVE") {
      throw new DomainError("INVALID_TOKEN", "Session token is invalid or expired", 401);
    }

    const roles = user.roles.map((r) => r.role.code);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles,
      permissions: [...permissionsForRoles(roles)],
    };
  }

  async listUsers() {
    const users = await this.db.user.findMany({
      orderBy: { createdAt: "asc" },
      include: { roles: { include: { role: true } } },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      status: u.status,
      roles: u.roles.map((r) => r.role.code),
      createdAt: u.createdAt,
    }));
  }

  async listRoles() {
    const roles = await this.db.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { code: "asc" },
    });
    return roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      permissions: r.permissions.map((p) => p.permission.code),
    }));
  }

  /** USER_MANAGE only. New accounts get whatever password the admin sets. */
  async createUser(
    input: { email: string; displayName: string; password: string; roleCodes: string[] },
    context: AuditContext
  ) {
    if (!input.email?.trim()) throw new ValidationError("email is required");
    if (!input.displayName?.trim()) throw new ValidationError("displayName is required");
    if (!input.roleCodes?.length) throw new ValidationError("At least one role is required");
    const badRole = input.roleCodes.find((code) => !isRoleCode(code));
    if (badRole) throw new ValidationError("Unknown role code", { role: badRole });
    assertStrongEnough(input.password);

    const existing = await this.db.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ValidationError("A user with this email already exists", { email: input.email });
    }

    const roles = await this.db.role.findMany({ where: { code: { in: input.roleCodes } } });

    const user = await this.db.user.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        passwordHash: hashPassword(input.password),
        roles: { create: roles.map((role) => ({ roleId: role.id })) },
      },
    });

    await this.audit.record(context, {
      action: "USER_CREATED",
      resource: "User",
      resourceId: user.id,
      after: { email: user.email, displayName: user.displayName, roles: input.roleCodes },
    });

    return { id: user.id, email: user.email, displayName: user.displayName, status: user.status };
  }

  /** USER_MANAGE only. Disabling does not delete anything — it can be undone the same way. */
  async setUserStatus(userId: string, status: "ACTIVE" | "DISABLED", context: AuditContext) {
    const existing = await this.db.user.findUnique({ where: { id: userId } });
    if (!existing) throw new DomainError("USER_NOT_FOUND", "User not found", 404, { userId });
    if (existing.status === status) return existing;

    const updated = await this.db.user.update({ where: { id: userId }, data: { status } });

    await this.audit.record(context, {
      action: "USER_STATUS_UPDATED",
      resource: "User",
      resourceId: userId,
      before: { status: existing.status },
      after: { status },
    });

    return updated;
  }

  /**
   * Anyone changes their own password, and only their own — there is no
   * "set someone else's password" path, even for USER_MANAGE, so a
   * compromised admin account cannot silently take over another account.
   * The current password must be proven first: a left-open session should
   * not be enough on its own to lock the real owner out.
   */
  async changeOwnPassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
    context: AuditContext
  ) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new DomainError("USER_NOT_FOUND", "User not found", 404, { userId });
    if (!verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new DomainError("INVALID_CREDENTIALS", "Current password is incorrect", 401);
    }
    assertStrongEnough(input.newPassword);

    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(input.newPassword) },
    });

    // Never logs the password itself, before or after.
    await this.audit.record(context, {
      action: "PASSWORD_CHANGED",
      resource: "User",
      resourceId: userId,
      after: { changedAt: new Date().toISOString() },
    });
  }
}
