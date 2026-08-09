import { fileURLToPath } from "node:url";

import sharedConfig from "@ryot-app/testing/vitest.shared";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	sharedConfig,
	defineConfig({
		resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
		test: { env: { TZ: "UTC" }, exclude: [...configDefaults.exclude, "**/*.component.test.tsx"] },
	}),
);
