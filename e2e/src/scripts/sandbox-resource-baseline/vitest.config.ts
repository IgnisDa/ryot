import shared from "@ryot-app/testing/vitest.shared";
import { defineConfig, mergeConfig } from "vitest/config";

const packageRoot = Bun.fileURLToPath(new URL("../../../", import.meta.url));
const srcDir = Bun.fileURLToPath(new URL("../../", import.meta.url));

/**
 * The package config attaches `global-setup.ts`, which provisions containers. These are pure unit
 * tests for the benchmark tooling, so they run under their own config with no harness.
 */
export default mergeConfig(
	shared,
	defineConfig({
		resolve: { alias: [{ find: /^~\//, replacement: srcDir }] },
		test: { root: packageRoot, include: ["src/scripts/sandbox-resource-baseline/**/*.test.ts"] },
	}),
);
