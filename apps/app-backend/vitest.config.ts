import shared from "@ryot/testing/vitest.shared";
import { defineConfig, mergeConfig } from "vitest/config";

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

export default mergeConfig(
	shared,
	defineConfig({
		test: { testTimeout: 20_000, setupFiles: ["./test-setup.ts"] },
		resolve: { alias: [{ find: /^#(lib|modules)\//, replacement: `${srcDir}$1/` }] },
	}),
);
