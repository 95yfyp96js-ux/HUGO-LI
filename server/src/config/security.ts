import { ConfigurationError } from "../shared/errors.js";

/**
 * Startup security configuration.
 *
 * The rule this enforces: a production process must never run on a secret
 * that anyone could guess or that shipped in the repository. Development and
 * test keep a convenient default, but production may not inherit it — it
 * refuses to start instead, because a silently-weak signing key is worse
 * than an outage.
 *
 * Nothing here ever logs or echoes a secret value: errors name the variable
 * and the reason, never the content.
 */

/** The development default. Production must never resolve to this. */
export const DEV_JWT_SECRET = "dev-only-insecure-secret";

/**
 * Values that must be refused in production: this repository's own default,
 * plus the placeholders people paste in while wiring up a deployment.
 */
const FORBIDDEN_SECRETS = new Set(
  [
    DEV_JWT_SECRET,
    "secret",
    "jwtsecret",
    "jwt_secret",
    "changeme",
    "change-me",
    "password",
    "development",
    "dev",
    "test",
    "insecure",
    "todo",
    "xxx",
  ].map((value) => value.toLowerCase())
);

/**
 * 32 characters is the shortest key we will accept for HS256. It is a blunt
 * proxy for entropy, but it reliably rejects the hand-typed keys that show up
 * in real incidents.
 */
export const MIN_SECRET_LENGTH = 32;

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

/** Explains why a secret is unfit, or null when it is acceptable. */
export function describeSecretWeakness(secret: string | undefined | null): string | null {
  if (secret === undefined || secret === null || secret.trim() === "") {
    return "JWT_SECRET is not set";
  }
  const value = secret.trim();
  if (FORBIDDEN_SECRETS.has(value.toLowerCase())) {
    return "JWT_SECRET is a known development or placeholder value";
  }
  if (value.length < MIN_SECRET_LENGTH) {
    return `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`;
  }
  if (new Set(value).size < 8) {
    return "JWT_SECRET does not contain enough distinct characters";
  }
  return null;
}

export interface ResolveJwtSecretOptions {
  /** Explicit override, e.g. a test harness passing its own key. */
  explicit?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolves the signing key, failing fast in production rather than falling
 * back. An explicit override is still validated in production — a weak key
 * is weak regardless of how it arrived.
 */
export function resolveJwtSecret(options: ResolveJwtSecretOptions = {}): string {
  const env = options.env ?? process.env;
  const candidate = options.explicit ?? env.JWT_SECRET;

  if (isProduction(env)) {
    const weakness = describeSecretWeakness(candidate);
    if (weakness) {
      throw new ConfigurationError(
        `Refusing to start in production: ${weakness}. ` +
          `Set JWT_SECRET to a random value of at least ${MIN_SECRET_LENGTH} characters.`
      );
    }
    return candidate!.trim();
  }

  return candidate?.trim() || DEV_JWT_SECRET;
}

/**
 * Validates everything that must hold before the process serves traffic.
 * P10 extends this; today it covers the signing key.
 */
export function validateStartupConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  resolveJwtSecret({ env });
}
