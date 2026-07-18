import shared from "@ryot/testing/vitest.shared";
import { defineConfig, mergeConfig } from "vitest/config";

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

export default mergeConfig(
	shared,
	defineConfig({
		test: { testTimeout: 20_000 },
		resolve: { alias: [{ find: /^#(lib|modules)\//, replacement: `${srcDir}$1/` }] },
	}),
);
