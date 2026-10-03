import shared from "@ryot-app/testing/vitest.shared";
import dotenv from "dotenv";
import { defineConfig, mergeConfig } from "vitest/config";

dotenv.config();

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

export default mergeConfig(
	shared,
	defineConfig({
		resolve: { alias: [{ find: /^#(lib|modules)\//, replacement: `${srcDir}$1/` }] },
		test: { testTimeout: 20_000, hookTimeout: 120_000, globalSetup: ["./global-setup.ts"] },
	}),
);
