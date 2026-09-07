import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { createContainer, type Container, type ContainerOptions } from "./container.js";
import { createRoutes } from "./presentation/routes.js";
import { errorHandler } from "./presentation/middleware.js";

export function createApp(options: ContainerOptions = {}): { app: Express; container: Container } {
  const container = createContainer(options);

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", createRoutes(container));
  app.use(errorHandler());

  return { app, container };
}
