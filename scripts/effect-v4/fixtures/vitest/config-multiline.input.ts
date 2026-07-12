import { defineConfig as config, mergeConfig as merge } from "vitest/config";

const shared = {};

export default merge(
	shared,
	config({
		test: {
			bail: 1,
			setupFiles: ["./test-setup.ts"],
			globalSetup: ["./global-setup.ts"],
			reporters: ["default"],
		},
	}),
);
