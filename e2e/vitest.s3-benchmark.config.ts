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
			maxWorkers: 1,
			isolate: false,
			hookTimeout: 180_000,
			testTimeout: 7_200_000,
			reporters: ["hanging-process", "default"],
			globalSetup: ["./s3-benchmark-global-setup.ts"],
			include: ["src/api/kernel/sandbox/s3-benchmark-*.test.ts"],
		},
	}),
);
