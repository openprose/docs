import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    globals: false,
  },
});
