import { defineConfig } from "vitest/config";

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

export default defineConfig({
	resolve: { alias: [{ find: /^#(lib|modules)\//, replacement: `${srcDir}$1/` }] },
	test: {
		testTimeout: 20_000,
		reporters: ["agent"],
		include: ["src/**/*.test.ts"],
		setupFiles: ["./test-setup.ts"],
	},
});
