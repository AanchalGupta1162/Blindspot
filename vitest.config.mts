import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { setupFiles: ["./tests/setup.ts"], include: ["tests/**/*.test.ts"], testTimeout: 60000, hookTimeout: 60000, maxWorkers: 4 },
  resolve: { alias: { "server-only": new URL("./tests/stubs/empty.ts", import.meta.url).pathname } },
});
