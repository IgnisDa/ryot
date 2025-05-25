import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
	return {
		test: {
			globals: true,
			testTimeout: 60000,
			hookTimeout: 60000,
			environment: "node",
			globalSetup: ["./src/setup/globalSetup.ts"],
			env: loadEnv(mode, process.cwd(), ""),
		},
	};
});
