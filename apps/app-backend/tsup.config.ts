import { defineConfig } from "tsup";

export default defineConfig({
	clean: true,
	outDir: "dist",
	format: ["esm"],
	platform: "node",
	target: "node22",
	splitting: false,
	entry: ["src/index.ts"],
});
