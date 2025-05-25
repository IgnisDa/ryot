import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		testTimeout: 60000,
		hookTimeout: 60000,
		environment: "node",
		globalSetup: ["dotenv/config", "./src/setup/globalSetup.ts"],
	},
});
