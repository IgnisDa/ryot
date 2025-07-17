import { config } from "dotenv";
import tsconfigPaths from "vite-tsconfig-paths";
import { type Plugin, defineConfig } from "vitest/config";

config();

export default defineConfig({
	// FIXME: Remove when https://github.com/aleclarson/vite-tsconfig-paths/issues/176
	plugins: [tsconfigPaths({ ignoreConfigErrors: true }) as Plugin],
	test: {
		globals: true,
		testTimeout: 60000,
		hookTimeout: 60000,
		environment: "node",
		globalSetup: ["./src/setup/globalSetup.ts"],
	},
});
