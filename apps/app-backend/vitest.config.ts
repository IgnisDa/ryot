import { defineConfig } from "vitest/config";

const srcDir = new URL("./src/", import.meta.url).pathname;

export default defineConfig({
	test: { include: ["src/**/*.test.ts"], setupFiles: ["./test-setup.ts"] },
	resolve: { alias: [{ find: /^#(lib|modules)\//, replacement: `${srcDir}$1/` }] },
});
