import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, ".env.local"), override: true });

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
