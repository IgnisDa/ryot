import { defineConfig, mergeConfig } from "vitest/config";

const shared = {};

export default mergeConfig(
	shared,
	defineConfig({
		test: { setupFiles: ["./test-setup.ts", "./other-setup.ts"], testTimeout: 20_000 },
	}),
);
