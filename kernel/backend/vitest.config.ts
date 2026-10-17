import shared from "@ryot-app/testing/vitest.shared";
import dotenv from "dotenv";
import { defineConfig, mergeConfig } from "vitest/config";

dotenv.config();

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

export default mergeConfig(
	shared,
	defineConfig({
		resolve: {
			alias: [{ replacement: `${srcDir}$1/`, find: /^#(boot|modules|platform|schema|testing)\// }],
		},
		test: {
			maxWorkers: 4,
			testTimeout: 120_000,
			hookTimeout: 120_000,
			globalSetup: ["./global-setup.ts"],
		},
	}),
);
