import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: ["lib/**", "app/**"],
      reporter: ["text-summary", "json-summary", "html"],
    },
  },
});
