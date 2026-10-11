import { defineClientConfig } from "@ryot-app/testing/vitest.client";

export default defineClientConfig({
	maxWorkers: 2,
	testTimeout: 12_000,
	setupFiles: ["./vitest.setup.ts"],
});
