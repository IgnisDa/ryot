import shared from "@ryot-app/testing/vitest.shared";
import dotenv from "dotenv";
import { defineConfig, mergeConfig } from "vitest/config";

dotenv.config();

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

export default mergeConfig(
	shared,
	defineConfig({
		resolve: { alias: [{ find: /^~\//, replacement: srcDir }] },
		test: {
			maxWorkers: 6,
			isolate: false,
			testTimeout: 180_000,
			hookTimeout: 180_000,
			globalSetup: ["./global-setup.ts"],
			reporters: ["hanging-process", "default"],
			include: ["src/api/**/*.test.ts", "src/browser/**/*.test.ts"],
		},
	}),
);
