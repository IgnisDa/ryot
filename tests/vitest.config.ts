import shared from "@ryot/testing/vitest.shared";
import { defineConfig, mergeConfig } from "vitest/config";

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

export default mergeConfig(
	shared,
	defineConfig({
		resolve: { alias: [{ find: /^~\//, replacement: srcDir }] },
		test: {
			bail: 1,
			isolate: false,
			testTimeout: 180_000,
			hookTimeout: 180_000,
			setupFiles: ["./test-setup.ts"],
			globalSetup: ["./global-setup.ts"],
			include: ["src/tests/**/*.test.ts"],
			reporters: process.env.AGENT === "1" ? ["hanging-process"] : ["hanging-process", "default"],
		},
	}),
);
