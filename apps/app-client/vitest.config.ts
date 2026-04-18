import { fileURLToPath } from "node:url";

import sharedConfig from "@ryot/testing/vitest.shared";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	sharedConfig,
	defineConfig({
		test: { exclude: [...configDefaults.exclude, "**/*.component.test.tsx"] },
		resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
	}),
);
