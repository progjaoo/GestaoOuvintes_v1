import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    fileParallelism: false,
    testTimeout: 30_000,
    exclude: ["dist/**", "node_modules/**"],
  },
});
