import shared from "@ryot-app/testing/vitest.shared";
import { defineConfig, mergeConfig } from "vitest/config";

const srcDir = Bun.fileURLToPath(new URL("./src/", import.meta.url));

export default mergeConfig(
	shared,
	defineConfig({
		test: { include: ["src/support/**/*.test.ts"] },
		resolve: { alias: [{ find: /^~\//, replacement: srcDir }] },
	}),
);
