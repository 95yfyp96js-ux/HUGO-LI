import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // `preview` mode builds the static, read-only snapshot bundle. This is a
  // compile-time literal rather than an env lookup so the branch is
  // unambiguously included (or eliminated) by the bundler.
  define: {
    __STATIC_SNAPSHOT__: JSON.stringify(mode === "preview"),
  },
  // The snapshot is looked up by dynamic key, so Rollup's named-export
  // tree-shaking would otherwise strip the whole payload.
  json: { stringify: true },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
}));
