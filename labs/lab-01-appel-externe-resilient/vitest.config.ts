// Oracle du lab : `@lab/*` -> TON code (src/). `npm run lab:01` depuis 17-distributed-systems/labs.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@lab": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["test/**/*.spec.ts", "test/**/*.test.ts"],
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"], tsconfig: "./tsconfig.json" },
  },
});
