import shared from "@ryot/testing/vitest.shared";
import dotenv from "dotenv";
import { defineConfig, mergeConfig } from "vitest/config";

dotenv.config();

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

export default mergeConfig(
	shared,
	defineConfig({
		resolve: { alias: [{ find: /^~\//, replacement: srcDir }] },
		test: {
			isolate: false,
			testTimeout: 180_000,
			hookTimeout: 180_000,
			globalSetup: ["./global-setup.ts"],
			include: ["src/tests/**/*.test.ts"],
			reporters: ["hanging-process", "default"],
		},
	}),
);
