import { defineConfig } from "tsup";

export default defineConfig({
	clean: true,
	outDir: "dist",
	format: ["esm"],
	sourcemap: true,
	platform: "node",
	target: "node22",
	splitting: false,
	noExternal: [/.*/],
	entry: ["src/index.ts"],
});
