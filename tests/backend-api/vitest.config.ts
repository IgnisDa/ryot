import { defineConfig } from "vitest/config";
import { config } from "dotenv";

config();

export default defineConfig(() => {
	return {
		test: {
			globals: true,
			env: process.env,
			testTimeout: 60000,
			hookTimeout: 60000,
			environment: "node",
			globalSetup: ["./src/setup/globalSetup.ts"],
		},
	};
});
