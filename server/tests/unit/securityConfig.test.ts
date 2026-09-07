import { describe, expect, it } from "vitest";
import {
  DEV_JWT_SECRET,
  MIN_SECRET_LENGTH,
  describeSecretWeakness,
  resolveJwtSecret,
  validateStartupConfiguration,
} from "../../src/config/security.js";
import { ConfigurationError } from "../../src/shared/errors.js";

const STRONG = "Zt7pQ4mX9wKvL2rN8sB6yH3jD5fG1aCe";
const prod = (extra: NodeJS.ProcessEnv = {}) =>
  ({ NODE_ENV: "production", ...extra }) as NodeJS.ProcessEnv;

describe("JWT secret configuration", () => {
  describe("in production", () => {
    it("refuses to start when JWT_SECRET is missing", () => {
      expect(() => resolveJwtSecret({ env: prod() })).toThrow(ConfigurationError);
      expect(() => resolveJwtSecret({ env: prod() })).toThrow(/JWT_SECRET is not set/);
    });

    it("refuses a blank secret", () => {
      expect(() => resolveJwtSecret({ env: prod({ JWT_SECRET: "   " }) })).toThrow(/not set/);
    });

    it("refuses the shipped development default", () => {
      expect(() => resolveJwtSecret({ env: prod({ JWT_SECRET: DEV_JWT_SECRET }) })).toThrow(
        /known development or placeholder value/
      );
    });

    it("refuses common placeholder secrets", () => {
      for (const placeholder of ["secret", "changeme", "password", "TEST", "Dev"]) {
        expect(
          () => resolveJwtSecret({ env: prod({ JWT_SECRET: placeholder }) }),
          `expected ${placeholder} to be refused`
        ).toThrow(ConfigurationError);
      }
    });

    it("refuses a secret that is too short", () => {
      expect(() => resolveJwtSecret({ env: prod({ JWT_SECRET: "a1b2c3d4e5" }) })).toThrow(
        new RegExp(`at least ${MIN_SECRET_LENGTH} characters`)
      );
    });

    it("refuses a long secret with almost no variety", () => {
      expect(() => resolveJwtSecret({ env: prod({ JWT_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }) })).toThrow(
        /distinct characters/
      );
    });

    it("accepts a strong secret", () => {
      expect(resolveJwtSecret({ env: prod({ JWT_SECRET: STRONG }) })).toBe(STRONG);
    });

    it("validates an explicitly supplied secret too — a weak key is weak however it arrives", () => {
      expect(() => resolveJwtSecret({ explicit: "short", env: prod() })).toThrow(ConfigurationError);
      expect(resolveJwtSecret({ explicit: STRONG, env: prod() })).toBe(STRONG);
    });

    it("never includes the secret value in the error", () => {
      const secret = "hunter2-hunter2-hunter2-hunter2!!";
      try {
        resolveJwtSecret({ env: prod({ JWT_SECRET: "hunter2" }) });
        throw new Error("expected a ConfigurationError");
      } catch (error) {
        const text = `${(error as Error).message} ${JSON.stringify((error as ConfigurationError).details)}`;
        expect(text).not.toContain("hunter2");
        expect(text).not.toContain(secret);
      }
    });

    it("blocks startup validation entirely", () => {
      expect(() => validateStartupConfiguration(prod())).toThrow(ConfigurationError);
      expect(() => validateStartupConfiguration(prod({ JWT_SECRET: STRONG }))).not.toThrow();
    });
  });

  describe("outside production", () => {
    it("falls back to the development secret", () => {
      expect(resolveJwtSecret({ env: { NODE_ENV: "development" } })).toBe(DEV_JWT_SECRET);
      expect(resolveJwtSecret({ env: { NODE_ENV: "test" } })).toBe(DEV_JWT_SECRET);
    });

    it("still prefers a configured secret", () => {
      expect(resolveJwtSecret({ env: { NODE_ENV: "development", JWT_SECRET: STRONG } })).toBe(STRONG);
    });

    it("does not reject weak secrets in development", () => {
      expect(resolveJwtSecret({ env: { NODE_ENV: "development", JWT_SECRET: "weak" } })).toBe("weak");
    });

    it("lets a test harness inject its own key", () => {
      expect(resolveJwtSecret({ explicit: "test-secret", env: { NODE_ENV: "test" } })).toBe("test-secret");
    });
  });

  describe("weakness reporting", () => {
    it("accepts a strong secret", () => {
      expect(describeSecretWeakness(STRONG)).toBeNull();
    });

    it("reports each category of weakness", () => {
      expect(describeSecretWeakness(undefined)).toMatch(/not set/);
      expect(describeSecretWeakness("")).toMatch(/not set/);
      expect(describeSecretWeakness(DEV_JWT_SECRET)).toMatch(/development or placeholder/);
      expect(describeSecretWeakness("tooshort")).toMatch(/at least/);
    });
  });
});
