import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test-ui/**/*.test.tsx"],
    setupFiles: ["./test-ui/setup.ts"],
  },
});
