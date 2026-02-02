import { config } from "dotenv";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

config();

export default defineConfig({
	plugins: [tsconfigPaths({ ignoreConfigErrors: true })],
	test: {
		globals: true,
		testTimeout: 60000,
		hookTimeout: 60000,
		environment: "node",
		fileParallelism: false,
		globalSetup: ["./src/setup/global-setup.ts"],
	},
});
