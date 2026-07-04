import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		reporters: ["agent"],
		include: ["src/**/*.test.ts"],
		setupFiles: ["./test-setup.ts"],
	},
});
