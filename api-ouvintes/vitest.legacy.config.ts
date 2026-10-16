import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    fileParallelism: false,
    testTimeout: 30_000,
    include: ["tests/compat/**/*.test.ts", "tests/integration/api.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
