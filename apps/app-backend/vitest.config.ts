import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { include: ["src/**/*.test.ts"], setupFiles: ["./test-setup.ts"] },
	resolve: { alias: { "~": new URL("./src", import.meta.url).pathname } },
});
