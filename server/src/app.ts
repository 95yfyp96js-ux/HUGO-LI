import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { createContainer, type Container, type ContainerOptions } from "./container.js";
import { createRoutes } from "./presentation/routes.js";
import { errorHandler } from "./presentation/middleware.js";
import { DEFAULT_RATE_LIMITS, type RateLimitSettings } from "./presentation/rateLimit.js";

export interface AppOptions extends ContainerOptions {
  /** Overridable so tests can prove the limiter without hammering it. */
  rateLimits?: RateLimitSettings;
}

export function createApp(options: AppOptions = {}): { app: Express; container: Container } {
  const container = createContainer(options);

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", createRoutes(container, options.rateLimits ?? DEFAULT_RATE_LIMITS));
  app.use(errorHandler());

  return { app, container };
}
