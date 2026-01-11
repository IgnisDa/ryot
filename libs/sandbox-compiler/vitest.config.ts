import shared from "@ryot/testing/vitest.shared";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	shared,
	defineConfig({
		test: { setupFiles: ["./test-setup.ts"] },
	}),
);
