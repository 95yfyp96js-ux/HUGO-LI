import type { NextFunction, Request, Response } from "express";
import { DomainError, InsufficientPermissionError } from "../shared/errors.js";
import type { AuthenticatedUser } from "../modules/auth/application/authService.js";
import type { Permission } from "../modules/auth/domain/permissions.js";
import type { Container } from "../container.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authenticate(container: Container) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return next(new DomainError("UNAUTHENTICATED", "Authentication required", 401));
    }
    try {
      req.user = await container.auth.verifyToken(header.slice("Bearer ".length));
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Server-side permission check. The UI hides what a user cannot do, but this
 * is the check that actually enforces it (§52: frontend AND backend).
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new DomainError("UNAUTHENTICATED", "Authentication required", 401));
    }
    if (!req.user.permissions.includes(permission)) {
      return next(new InsufficientPermissionError(permission));
    }
    next();
  };
}

export function auditContext(req: Request) {
  return {
    userId: req.user?.id ?? null,
    ip: req.ip ?? null,
  };
}

/** Unified error model (§51): every failure is {code, message, details}. */
export function errorHandler() {
  return (error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof DomainError) {
      return res.status(error.httpStatus).json({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }

    // Never leak internals to the client; log server-side with no PII payload.
    console.error(`[error] ${req.method} ${req.path}`, error instanceof Error ? error.message : error);

    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      details: {},
    });
  };
}

export function asyncHandler<T>(
  handler: (req: Request, res: Response) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export function requireIdempotencyKey(req: Request): string {
  const key = req.header("Idempotency-Key");
  if (!key) {
    throw new DomainError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "This endpoint requires an Idempotency-Key header",
      400
    );
  }
  return key;
}
