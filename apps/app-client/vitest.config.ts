import { fileURLToPath } from "node:url";

import sharedConfig from "@ryot/testing/vitest.shared";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	sharedConfig,
	defineConfig({ resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } } }),
);
