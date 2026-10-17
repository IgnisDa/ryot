import shared from "@ryot-app/testing/vitest.shared";
import dotenv from "dotenv";
import { defineConfig, mergeConfig } from "vitest/config";

dotenv.config();

export default mergeConfig(
	shared,
	defineConfig({
		test: {
			maxWorkers: 4,
			testTimeout: 120_000,
			hookTimeout: 120_000,
			globalSetup: ["./global-setup.ts"],
		},
	}),
);
