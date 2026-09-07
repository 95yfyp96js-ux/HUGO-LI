import type { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { DomainError } from "../../../shared/errors.js";
import { verifyPassword } from "../infrastructure/password.js";
import { permissionsForRoles, type Permission } from "../domain/permissions.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: Permission[];
}

const TOKEN_TTL = "12h";

export class AuthService {
  constructor(
    private readonly db: PrismaClient,
    private readonly jwtSecret: string
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
}
