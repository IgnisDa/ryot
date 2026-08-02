import { join } from "node:path";

import { BunFileSystem } from "@effect/platform-bun";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Result } from "effect";

import {
	acquireCompilerWorkspace,
	buildWithVite,
	collectViteOutputs,
	getCompilerWorkspaceRoot,
	sanitizeEnvironment,
	stageGeneratedFiles,
	stageSourceFiles,
	validateRelativePath,
	ViteBuildService,
	ViteBuildInvocationError,
} from "./index";
import type { CompilerWorkspace, ViteCompilerError } from "./index";

const liveLayer = Layer.merge(BunFileSystem.layer, ViteBuildService.layer);

const errorReason = <Value>(result: Result.Result<Value, ViteCompilerError>) =>
	Result.isFailure(result) ? result.failure.reason : undefined;

describe("compiler workspace", () => {
	it.effect.each([
		"/absolute.ts",
		"../escape.ts",
		"nested/../../escape.ts",
		"C:\\escape.ts",
		"a\\b.ts",
		"a//b.ts",
	])("rejects unsafe path %s", (path) =>
		Effect.sync(() => {
			expect(errorReason(validateRelativePath(path))).toBe("invalid-input");
		}),
	);

	it.effect("rejects traversal in a supervisor job identity", () =>
		Effect.sync(() => {
			expect(
				errorReason(getCompilerWorkspaceRoot({ jobId: "../other", parentPath: "/tmp/jobs" })),
			).toBe("invalid-input");
		}),
	);

	it.effect("rejects collisions, symlinks, and unsupported input before writing files", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const workspace = yield* acquireCompilerWorkspace();
			const duplicate = yield* Effect.flip(
				stageSourceFiles(workspace, [
					{ path: "same.ts", contents: "first" },
					{ path: "same.ts", contents: "second" },
				]),
			);
			expect(duplicate.reason).toBe("workspace-collision");
			expect(yield* fs.exists(join(workspace.sourcePath, "same.ts"))).toBe(false);

			yield* stageSourceFiles(workspace, [{ path: "existing.ts", contents: "existing" }]);
			const existing = yield* Effect.flip(
				stageSourceFiles(workspace, [
					{ contents: "new", path: "a-new.ts" },
					{ path: "existing.ts", contents: "replacement" },
				]),
			);
			expect(existing.reason).toBe("workspace-collision");
			expect(yield* fs.exists(join(workspace.sourcePath, "a-new.ts"))).toBe(false);

			const symlink = yield* Effect.flip(
				stageSourceFiles(workspace, [{ kind: "symlink", path: "link.ts", target: "target.ts" }]),
			);
			expect(symlink.reason).toBe("workspace-symlink");

			const unsupported = yield* Effect.flip(
				stageSourceFiles(workspace, [
					// Runtime callers can cross the TypeScript boundary with unsupported data.
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					{ contents: 1, path: "bad.ts" } as never,
				]),
			);
			expect(unsupported.reason).toBe("invalid-input");
		}).pipe(Effect.provide(BunFileSystem.layer)),
	);

	it.effect(
		"preserves deterministic source paths in separate source and generated namespaces",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const workspace = yield* acquireCompilerWorkspace();
				const staged = yield* stageSourceFiles(workspace, [
					{ contents: "z", path: "nested/z.ts" },
					{ path: "a.ts", contents: new TextEncoder().encode("a") },
				]);
				yield* stageGeneratedFiles(workspace, [{ path: "a.ts", contents: "generated" }]);
				expect(staged).toEqual(["a.ts", "nested/z.ts"]);
				expect(yield* fs.readFileString(join(workspace.sourcePath, "a.ts"))).toBe("a");
				expect(yield* fs.readFileString(join(workspace.sourcePath, "nested/z.ts"))).toBe("z");
				expect(yield* fs.readFileString(join(workspace.generatedPath, "a.ts"))).toBe("generated");
				expect(workspace.outputPath).toBe(join(workspace.rootPath, "output"));
			}).pipe(Effect.provide(BunFileSystem.layer)),
	);

	it.effect("rejects a filesystem symlink without partially staging earlier paths", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const workspace = yield* acquireCompilerWorkspace();
			yield* fs.makeDirectory(join(workspace.sourcePath, "nested"));
			yield* fs.symlink(workspace.generatedPath, join(workspace.sourcePath, "nested/link"));
			const failure = yield* Effect.flip(
				stageSourceFiles(workspace, [
					{ path: "a.ts", contents: "must not be staged" },
					{ contents: "no", path: "nested/link/escape.ts" },
				]),
			);
			expect(failure.reason).toBe("workspace-symlink");
			expect(yield* fs.exists(join(workspace.sourcePath, "a.ts"))).toBe(false);
		}).pipe(Effect.provide(BunFileSystem.layer)),
	);

	it.effect("releases the workspace through its owning scope with an injected filesystem", () => {
		const removed: string[] = [];
		const fileSystemLayer = Layer.succeed(
			FileSystem.FileSystem,
			FileSystem.makeNoop({
				makeDirectory: () => Effect.void,
				makeTempDirectory: () => Effect.succeed("/virtual/job"),
				remove: (path) => Effect.sync(() => removed.push(path)),
			}),
		);
		return Effect.gen(function* () {
			yield* Effect.scoped(acquireCompilerWorkspace());
			expect(removed).toEqual(["/virtual/job"]);
		}).pipe(Effect.provide(fileSystemLayer));
	});

	it.effect("removes a supervisor-addressable workspace after success and failure", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const owner = yield* acquireCompilerWorkspace();
			for (const jobId of ["successful-job", "failed-job"]) {
				const options = { jobId, parentPath: owner.generatedPath };
				const root = yield* Effect.fromResult(getCompilerWorkspaceRoot(options));
				const useWorkspace = Effect.scoped(
					Effect.gen(function* () {
						const workspace = yield* acquireCompilerWorkspace(options);
						expect(workspace.rootPath).toBe(root);
						if (jobId === "failed-job") {
							return yield* Effect.fail("expected failure");
						}
						return "ok";
					}),
				);
				if (jobId === "failed-job") {
					yield* Effect.flip(useWorkspace);
				} else {
					expect(yield* useWorkspace).toBe("ok");
				}
				expect(yield* fs.exists(root)).toBe(false);
			}
		}).pipe(Effect.provide(BunFileSystem.layer)),
	);
});

describe("Vite output", () => {
	it.effect("collects result arrays as copied bytes in deterministic path order", () =>
		Effect.sync(() => {
			const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
			const collected = collectViteOutputs([
				{
					output: [
						{ type: "asset", source: "<svg/>", fileName: "assets/icon.svg" },
						{ type: "asset", source: imageBytes, fileName: "assets/icon.png" },
					],
				},
				{ output: [{ type: "chunk", code: "export {};", fileName: "assets/app.js" }] },
			]);
			expect(Result.isSuccess(collected)).toBe(true);
			if (Result.isFailure(collected)) {
				return;
			}
			imageBytes.fill(0);
			expect(collected.success.map(({ path, contentType }) => [path, contentType])).toEqual([
				["assets/app.js", "text/javascript; charset=utf-8"],
				["assets/icon.png", "image/png"],
				["assets/icon.svg", "image/svg+xml"],
			]);
			expect(collected.success[1]?.bytes).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
		}),
	);

	it.effect("returns tagged failures for escaping and duplicate output paths", () =>
		Effect.sync(() => {
			expect(
				errorReason(
					collectViteOutputs({ output: [{ source: "", type: "asset", fileName: "../escape.js" }] }),
				),
			).toBe("invalid-output");
			expect(
				errorReason(
					collectViteOutputs([
						{ output: [{ type: "asset", source: "first", fileName: "same.js" }] },
						{ output: [{ type: "asset", source: "second", fileName: "same.js" }] },
					]),
				),
			).toBe("invalid-output");
		}),
	);
});

describe("worker environment", () => {
	it.effect("preserves only allowed variables and PATH when explicitly requested", () =>
		Effect.sync(() => {
			const source = { CI: "true", TOKEN: "hidden", API_SECRET: "hidden", PATH: "/trusted/bin" };
			const allowed = sanitizeEnvironment({ source, preserveNames: ["CI"] });
			const pathOnly = sanitizeEnvironment({ source, includePath: true });
			const empty = sanitizeEnvironment({ source });
			expect(Result.isSuccess(allowed) && allowed.success).toEqual({ CI: "true" });
			expect(Result.isSuccess(pathOnly) && pathOnly.success).toEqual({ PATH: "/trusted/bin" });
			expect(Result.isSuccess(empty) && empty.success).toEqual({});
			expect(errorReason(sanitizeEnvironment({ source, preserveNames: ["PATH"] }))).toBe(
				"invalid-input",
			);
		}),
	);
});

const virtualWorkspace: CompilerWorkspace = {
	rootPath: "/virtual/job",
	sourcePath: "/virtual/job/source",
	outputPath: "/virtual/job/output",
	generatedPath: "/virtual/job/generated",
};
const typeScriptProject = { compilerOptions: { target: "ES2022" } };

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
						return { output: [{ type: "chunk", code: "export {};", fileName: "app.js" }] };
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
				build: (config) =>
					Effect.sync(() => {
						roots.push(config.root);
						return { output: [{ type: "chunk", code: "export {};", fileName: "app.js" }] };
					}),
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
				const failure = yield* buildWithVite({
					root,
					config: {},
					typeScriptProject,
					workspace: virtualWorkspace,
				}).pipe(Effect.flip);
				expect(failure.reason).toBe("invalid-input");
			}
			expect(roots).toEqual([virtualWorkspace.generatedPath]);
		}).pipe(Effect.provide(viteLayer));
	});

	it.effect(
		"normalizes diagnostics against stable workspace paths with a generated Vite root",
		() => {
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
							return { output: [{ type: "chunk", code: "export {};", fileName: "app.js" }] };
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
		},
	);

	it.effect("normalizes an injected Vite failure into the tagged error channel", () => {
		const viteLayer = Layer.succeed(
			ViteBuildService,
			ViteBuildService.of({
				build: () =>
					Effect.fail(
						new ViteBuildInvocationError({
							cause: {
								errors: [
									{
										code: "BUILD_FAILURE",
										loc: { line: 2, column: 3 },
										message: "expected build failure",
										id: "/virtual/job/source/entry.ts",
									},
								],
							},
						}),
					),
			}),
		);
		return Effect.gen(function* () {
			const failure = yield* Effect.flip(
				buildWithVite({ config: {}, typeScriptProject, workspace: virtualWorkspace }),
			);
			expect(failure.reason).toBe("vite-build");
			expect(failure.diagnostics).toEqual([
				{
					severity: "error",
					code: "BUILD_FAILURE",
					file: "source/entry.ts",
					location: { line: 2, column: 3 },
					message: "expected build failure",
				},
			]);
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
