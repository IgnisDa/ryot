import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config();

export default defineConfig(() => {
	return {
		test: {
			globals: true,
			testTimeout: 60000,
			hookTimeout: 60000,
			environment: "node",
			globalSetup: ["./src/setup/globalSetup.ts"],
		},
	};
});
