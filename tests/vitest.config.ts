import { defineConfig } from "vitest/config";

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

export default defineConfig({
	resolve: { alias: [{ find: /^~\//, replacement: srcDir }] },
	test: {
		isolate: true,
		reporters: ["agent"],
		testTimeout: 180_000,
		hookTimeout: 180_000,
		setupFiles: ["./test-setup.ts"],
		globalSetup: ["./global-setup.ts"],
		include: ["src/tests/**/*.test.ts"],
	},
});
