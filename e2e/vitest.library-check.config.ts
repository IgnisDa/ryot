import { defineConfig } from "vitest/config";

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

export default defineConfig({
	resolve: { alias: [{ find: /^~\//, replacement: srcDir }] },
	test: {
		hookTimeout: 180_000,
		testTimeout: 7_200_000,
		include: ["src/api/perf/library-check.test.ts"],
	},
});
