import shared from "@ryot-app/testing/vitest.shared";
import { defineConfig, mergeConfig } from "vitest/config";

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

export default mergeConfig(
	shared,
	defineConfig({
		resolve: { alias: [{ find: /^~\//, replacement: srcDir }] },
		test: {
			maxWorkers: 1,
			isolate: false,
			hookTimeout: 180_000,
			testTimeout: 3_630_000,
			reporters: ["hanging-process", "default"],
			globalSetup: ["./benchmark-global-setup.ts"],
			include: ["src/api/plugins/media/imports/media-population-benchmark.test.ts"],
		},
	}),
);
