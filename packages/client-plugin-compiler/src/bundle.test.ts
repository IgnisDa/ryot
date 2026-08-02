import { expect, it } from "@effect/vitest";
import { type CompilerWorkspace, ViteBuildService } from "@ryot-app/vite-compiler";
import { Effect, Layer } from "effect";

import { bundleClientPlugin } from "./bundle";

const workspace: CompilerWorkspace = {
	rootPath: "/virtual/job",
	sourcePath: "/virtual/job/source",
	outputPath: "/virtual/job/output",
	generatedPath: "/virtual/job/generated",
};

it.effect("uses the generated Vite root without an output rewrite plugin", () => {
	let root: unknown;
	let plugins: unknown;
	const viteLayer = Layer.succeed(
		ViteBuildService,
		ViteBuildService.of({
			build: (config) =>
				Effect.sync(() => {
					root = config.root;
					plugins = config.plugins;
					return {
						output: [
							{ type: "chunk", code: "export {};", fileName: "plugin.js" },
							{
								type: "asset",
								fileName: "index.html",
								source: '<script type="module" src="./plugin.js"></script>',
							},
						],
					};
				}),
		}),
	);
	return Effect.gen(function* () {
		const result = yield* bundleClientPlugin({
			workspace,
			publicExports: {},
			entry: "client/index.tsx",
		});
		expect(root).toBe(workspace.generatedPath);
		expect(JSON.stringify(plugins)).not.toContain("ryot-stable-client-document");
		expect(
			new TextDecoder().decode(result.files.find(({ path }) => path === "index.html")?.bytes),
		).toContain('src="./plugin.js"');
	}).pipe(Effect.provide(viteLayer));
});
