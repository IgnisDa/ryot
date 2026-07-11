import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		reporters: ["agent"],
		include: ["tests/**/*.test.ts"],
	},
});
