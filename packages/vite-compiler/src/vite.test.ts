import { join } from "node:path";

import { BunFileSystem } from "@effect/platform-bun";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";

import {
	acquireCompilerWorkspace,
	buildWithVite,
	stageGeneratedFiles,
	stageSourceFiles,
	ViteBuildService,
} from "./index";
import type { CompilerWorkspace } from "./index";

const liveLayer = Layer.merge(BunFileSystem.layer, ViteBuildService.layer);
const virtualWorkspace: CompilerWorkspace = {
	rootPath: "/virtual/job",
	sourcePath: "/virtual/job/source",
	outputPath: "/virtual/job/output",
	generatedPath: "/virtual/job/generated",
};
const typeScriptProject = { compilerOptions: { target: "ES2022" } };
const output = { output: [{ type: "chunk", code: "export {};", fileName: "app.js" }] };

describe("Vite build", () => {
	it.effect("enforces protected configuration through an injected Vite service", () => {
		let observed: Record<string, unknown> = {};
		const viteLayer = Layer.succeed(
			ViteBuildService,
			ViteBuildService.of({
				build: (config) =>
					Effect.sync(() => {
						const onLog = config.build?.rolldownOptions?.onLog;
						observed = {
							oxc: config.oxc,
							root: config.root,
							envDir: config.envDir,
							appType: config.appType,
							cacheDir: config.cacheDir,
							write: config.build?.write,
							publicDir: config.publicDir,
							outDir: config.build?.outDir,
							postcss: config.css?.postcss,
							configFile: config.configFile,
							rolldownTsconfig: config.build?.rolldownOptions?.tsconfig,
						};
						if (typeof onLog === "function") {
							onLog(
								"warn",
								{
									plugin: "test-plugin",
									code: "PLUGIN_WARNING",
									message: "captured warning",
									loc: { line: 1, column: 7 },
									id: "/virtual/job/source/entry.ts",
								},
								() => undefined,
							);
						}
						return output;
					}),
			}),
		);
		return Effect.gen(function* () {
			const result = yield* buildWithVite({
				typeScriptProject,
				workspace: virtualWorkspace,
				config: {
					appType: "spa",
					root: "/caller-root",
					envDir: "/caller-env",
					build: { write: true },
					publicDir: "/caller-public",
					configFile: "caller.config.ts",
				},
			});
			expect(observed).toEqual({
				oxc: false,
				write: false,
				envDir: false,
				publicDir: false,
				appType: "custom",
				configFile: false,
				root: "/virtual/job",
				rolldownTsconfig: false,
				postcss: { plugins: [] },
				outDir: "/virtual/job/output",
				cacheDir: "/virtual/job/generated/vite-cache",
			});
			expect(result.files.map(({ path }) => path)).toEqual(["app.js"]);
			expect(result.diagnostics).toEqual([
				{
					severity: "warning",
					plugin: "test-plugin",
					code: "PLUGIN_WARNING",
					file: "source/entry.ts",
					message: "captured warning",
					location: { line: 1, column: 7 },
				},
			]);
		}).pipe(Effect.provide(viteLayer));
	});

	it.effect("allows only the generated directory as an alternate Vite root", () => {
		const roots: unknown[] = [];
		const viteLayer = Layer.succeed(
			ViteBuildService,
			ViteBuildService.of({
				build: (config) => Effect.sync(() => (roots.push(config.root), output)),
			}),
		);
		return Effect.gen(function* () {
			yield* buildWithVite({
				config: {},
				typeScriptProject,
				workspace: virtualWorkspace,
				root: virtualWorkspace.generatedPath,
			});
			for (const root of [virtualWorkspace.sourcePath, "/virtual/arbitrary"]) {
				const failure = yield* Effect.flip(
					buildWithVite({ root, config: {}, typeScriptProject, workspace: virtualWorkspace }),
				);
				expect(failure.reason).toBe("invalid-input");
			}
			expect(roots).toEqual([virtualWorkspace.generatedPath]);
		}).pipe(Effect.provide(viteLayer));
	});

	it.effect("normalizes diagnostics with a generated Vite root", () => {
		const viteLayer = Layer.succeed(
			ViteBuildService,
			ViteBuildService.of({
				build: (config) =>
					Effect.sync(() => {
						const onLog = config.build?.rolldownOptions?.onLog;
						if (typeof onLog === "function") {
							for (const [id, message] of [
								["bootstrap.tsx", "generated warning"],
								["../source/client/index.tsx", "source warning"],
							] as const) {
								onLog("warn", { id, message }, () => undefined);
							}
						}
						return output;
					}),
			}),
		);
		return Effect.gen(function* () {
			const result = yield* buildWithVite({
				config: {},
				typeScriptProject,
				workspace: virtualWorkspace,
				root: virtualWorkspace.generatedPath,
			});
			expect(result.diagnostics).toEqual([
				{ severity: "warning", message: "generated warning", file: "generated/bootstrap.tsx" },
				{ severity: "warning", message: "source warning", file: "source/client/index.tsx" },
			]);
		}).pipe(Effect.provide(viteLayer));
	});

	it.effect("normalizes the original injected Vite failure", () => {
		const cause = {
			errors: [
				{
					code: "BUILD_FAILURE",
					loc: { line: 2, column: 3 },
					message: "expected build failure",
					id: "/virtual/job/source/entry.ts",
				},
			],
		};
		const viteLayer = Layer.succeed(
			ViteBuildService,
			ViteBuildService.of({ build: () => Effect.fail(cause) }),
		);
		return Effect.gen(function* () {
			const failure = yield* Effect.flip(
				buildWithVite({ config: {}, typeScriptProject, workspace: virtualWorkspace }),
			);
			expect(failure.reason).toBe("vite-build");
			expect(failure.cause).toBe(cause);
			expect(failure.diagnostics?.[0]).toMatchObject({
				code: "BUILD_FAILURE",
				file: "source/entry.ts",
				message: "expected build failure",
			});
		}).pipe(Effect.provide(viteLayer));
	});

	it.effect("builds with the live Vite layer and keeps output in memory", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const workspace = yield* acquireCompilerWorkspace();
			yield* stageGeneratedFiles(workspace, [
				{ path: "entry.ts", contents: "export const value: number = 1;" },
			]);
			const result = yield* buildWithVite({
				workspace,
				typeScriptProject,
				config: {
					build: { rolldownOptions: { input: join(workspace.generatedPath, "entry.ts") } },
				},
			});
			expect(result.files).toHaveLength(1);
			expect(result.files[0]?.path).toMatch(/^assets\/entry-[A-Za-z0-9_-]+\.js$/);
			expect(yield* fs.readDirectory(workspace.outputPath)).toEqual([]);
		}).pipe(Effect.provide(liveLayer)),
	);

	it.effect("does not load a staged source package tsconfig", () =>
		Effect.gen(function* () {
			const workspace = yield* acquireCompilerWorkspace();
			yield* stageSourceFiles(workspace, [
				{ path: "dependency/index.ts", contents: "export const value: number = 1;" },
				{
					path: "dependency/tsconfig.json",
					contents: JSON.stringify({ extends: "../../missing-tsconfig.json" }),
				},
			]);
			yield* stageGeneratedFiles(workspace, [
				{ path: "entry.ts", contents: 'export { value } from "../source/dependency/index";' },
			]);
			const result = yield* buildWithVite({
				workspace,
				typeScriptProject,
				config: {
					build: { rolldownOptions: { input: join(workspace.generatedPath, "entry.ts") } },
				},
			});
			expect(result.files).toHaveLength(1);
			expect(result.diagnostics).toEqual([]);
		}).pipe(Effect.provide(liveLayer)),
	);
});
