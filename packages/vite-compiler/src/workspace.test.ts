import { BunFileSystem, BunPath } from "@effect/platform-bun";
import { describe, expect, it, layer } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Path, Result } from "effect";

import {
	acquireCompilerWorkspace,
	getCompilerWorkspaceRoot,
	sanitizeEnvironment,
	validateRelativePath,
} from "./index";
import type { CompilerWorkspace, ViteCompilerError, WorkspaceFile } from "./index";

const errorReason = <Value>(result: Result.Result<Value, ViteCompilerError>) =>
	Result.isFailure(result) ? result.failure.reason : undefined;

const liveLayer = Layer.merge(BunFileSystem.layer, BunPath.layer);

describe("compiler workspace", () => {
	it.effect.each([
		"",
		"/absolute.ts",
		"../escape.ts",
		"nested/../../escape.ts",
		"C:/escape.ts",
		"C:\\escape.ts",
		"a\\b.ts",
		"a//b.ts",
		"a/./b.ts",
		"a/../b.ts",
		"a\0b.ts",
	])("rejects unsafe path %s", (path) =>
		Effect.sync(() => expect(errorReason(validateRelativePath(path))).toBe("invalid-input")),
	);

	layer(liveLayer)((test) => {
		test.effect("rejects traversal and missing parents in supervisor job identities", () =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				expect(
					errorReason(
						getCompilerWorkspaceRoot(path, { jobId: "../other", parentPath: "/tmp/jobs" }),
					),
				).toBe("invalid-input");
				expect((yield* Effect.flip(acquireCompilerWorkspace({ jobId: "job" }))).reason).toBe(
					"invalid-input",
				);
			}),
		);

		test.effect("validates complete file sets before staging either namespace", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const owner = yield* acquireCompilerWorkspace();
				const collisions: readonly (readonly WorkspaceFile[])[] = [
					[
						{ path: "same.ts", contents: "first" },
						{ path: "same.ts", contents: "second" },
					],
					[
						{ path: "a/b.ts", contents: "child" },
						{ path: "a-b.ts", contents: "other" },
						{ path: "a", contents: "parent" },
					],
				];
				for (const files of collisions) {
					for (const namespace of ["sources", "generated"] as const) {
						const failure = yield* Effect.flip(
							acquireCompilerWorkspace({
								jobId: "invalid",
								[namespace]: files,
								parentPath: owner.generatedPath,
							}),
						);
						expect(failure.reason).toBe("workspace-collision");
						expect(yield* fs.readDirectory(owner.generatedPath)).toEqual([]);
					}
				}
				const writes: string[] = [];
				const failure = yield* Effect.flip(
					acquireCompilerWorkspace({
						jobId: "invalid",
						parentPath: owner.generatedPath,
						generated: [{ contents: "no", path: "../escape.ts" }],
						sources: [{ path: "valid.ts", contents: "must not be written" }],
					}).pipe(
						Effect.provideService(FileSystem.FileSystem, {
							...fs,
							writeFileString: (path, contents, options) => {
								writes.push(path);
								return fs.writeFileString(path, contents, options);
							},
						}),
					),
				);
				expect(failure.reason).toBe("invalid-input");
				expect(writes).toEqual([]);
				expect(yield* fs.readDirectory(owner.generatedPath)).toEqual([]);
			}),
		);

		test.effect(
			"publishes complete isolated namespaces and calculates generated contents from paths",
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const path = yield* Path.Path;
					const workspace = yield* acquireCompilerWorkspace({
						sources: [
							{ contents: "z", path: "nested/z.ts" },
							{ path: "a.ts", contents: new TextEncoder().encode("a") },
						],
						generated: ({ sourcePath, generatedPath }) => [
							{ path: "a.ts", contents: "generated" },
							{ path: "styles.css", contents: `${sourcePath}\n${generatedPath}` },
						],
					});
					expect(yield* fs.readFileString(path.join(workspace.sourcePath, "a.ts"))).toBe("a");
					expect(yield* fs.readFileString(path.join(workspace.sourcePath, "nested/z.ts"))).toBe(
						"z",
					);
					expect(yield* fs.readFileString(path.join(workspace.generatedPath, "a.ts"))).toBe(
						"generated",
					);
					expect(yield* fs.readFileString(path.join(workspace.generatedPath, "styles.css"))).toBe(
						`${workspace.sourcePath}\n${workspace.generatedPath}`,
					);
					expect(yield* fs.readDirectory(workspace.outputPath)).toEqual([]);
					expect(workspace.outputPath).toBe(path.join(workspace.rootPath, "output"));
				}),
		);

		test.effect(
			"creates private temporary and supervisor roots and releases their owning scopes",
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const owner = yield* acquireCompilerWorkspace();
					for (const jobId of [undefined, "private-job"]) {
						const root = yield* Effect.scoped(
							Effect.gen(function* () {
								const workspace = yield* acquireCompilerWorkspace({
									parentPath: owner.generatedPath,
									...(jobId === undefined ? {} : { jobId }),
								});
								expect((yield* fs.stat(workspace.rootPath)).mode & 0o777).toBe(0o700);
								return workspace.rootPath;
							}),
						);
						expect(yield* fs.exists(root)).toBe(false);
					}
				}),
		);

		test.effect(
			"preserves existing empty, populated, file, symlink, and dangling-symlink roots",
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const owner = yield* acquireCompilerWorkspace();
					const path = yield* Path.Path;
					const outside = path.join(owner.sourcePath, "outside.ts");
					yield* fs.writeFileString(outside, "untouched");
					for (const jobId of ["empty", "populated", "file", "symlink", "dangling"]) {
						const options = { jobId, parentPath: owner.generatedPath };
						const root = yield* Effect.fromResult(getCompilerWorkspaceRoot(path, options));
						if (jobId === "file") {
							yield* fs.writeFileString(root, "existing");
						} else if (jobId === "symlink" || jobId === "dangling") {
							yield* fs.symlink(
								jobId === "symlink" ? owner.sourcePath : path.join(owner.sourcePath, "missing"),
								root,
							);
						} else {
							yield* fs.makeDirectory(root);
							if (jobId === "populated") {
								yield* fs.symlink(owner.sourcePath, path.join(root, "source"));
								yield* fs.writeFileString(path.join(root, "keep"), "existing");
							}
						}
						const failure = yield* Effect.flip(
							Effect.scoped(
								acquireCompilerWorkspace({
									...options,
									sources: [{ path: "outside.ts", contents: "replacement" }],
								}),
							),
						);
						expect(failure.reason).toBe("workspace-collision");
						if (jobId === "file") {
							expect(yield* fs.readFileString(root)).toBe("existing");
						} else if (jobId === "symlink" || jobId === "dangling") {
							expect(yield* fs.readLink(root)).toBe(
								jobId === "symlink" ? owner.sourcePath : path.join(owner.sourcePath, "missing"),
							);
						} else {
							expect((yield* fs.readDirectory(root)).sort()).toEqual(
								jobId === "empty" ? [] : ["keep", "source"],
							);
							if (jobId === "populated") {
								expect(yield* fs.readFileString(path.join(root, "keep"))).toBe("existing");
							}
						}
						expect(yield* fs.readFileString(outside)).toBe("untouched");
					}
				}),
		);

		test.effect(
			"gives one concurrent owner an addressed root and keeps temporary roots distinct",
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const owner = yield* acquireCompilerWorkspace();
					const results = yield* Effect.all(
						Array.from({ length: 8 }, (_, index) =>
							acquireCompilerWorkspace({
								jobId: "race",
								parentPath: owner.generatedPath,
								sources: [{ path: "owner.ts", contents: String(index) }],
							}).pipe(Effect.result),
						),
						{ concurrency: "unbounded" },
					);
					const winners = results.filter(Result.isSuccess);
					expect(winners).toHaveLength(1);
					expect(results.filter(Result.isFailure).map(({ failure }) => failure.reason)).toEqual(
						Array(7).fill("workspace-collision"),
					);
					for (const { success } of winners) {
						expect(yield* fs.readFileString(`${success.sourcePath}/owner.ts`)).toBe(
							String(results.findIndex(Result.isSuccess)),
						);
					}
					const temporary = yield* Effect.all(
						Array.from({ length: 8 }, () =>
							acquireCompilerWorkspace({ parentPath: owner.sourcePath }),
						),
						{ concurrency: "unbounded" },
					);
					expect(new Set(temporary.map(({ rootPath }) => rootPath)).size).toBe(8);
				}),
		);

		test.effect(
			"cleans partial staging immediately and does not later remove a replacement owner",
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const path = yield* Path.Path;
					const owner = yield* acquireCompilerWorkspace();
					const options = { jobId: "partial", parentPath: owner.generatedPath };
					const root = yield* Effect.fromResult(getCompilerWorkspaceRoot(path, options));
					let staged = false;
					yield* Effect.scoped(
						Effect.gen(function* () {
							const failure = yield* Effect.flip(
								acquireCompilerWorkspace({
									...options,
									sources: [{ path: "a.ts", contents: "already staged" }],
									generated: [{ path: "fail.ts", contents: "not staged" }],
								}).pipe(
									Effect.provideService(FileSystem.FileSystem, {
										...fs,
										writeFileString: Effect.fnUntraced(
											function* (destination, contents, writeOptions) {
												if (destination.endsWith("/generated/fail.ts")) {
													staged =
														(yield* fs.readFileString(`${root}/source/a.ts`)) === "already staged";
													return yield* fs.writeFileString(
														`${root}/source/a.ts/child`,
														contents,
														writeOptions,
													);
												}
												return yield* fs.writeFileString(destination, contents, writeOptions);
											},
										),
									}),
								),
							);
							expect(failure.reason).toBe("workspace-filesystem");
							expect(staged).toBe(true);
							expect(yield* fs.exists(root)).toBe(false);
							yield* fs.makeDirectory(root);
							yield* fs.writeFileString(`${root}/replacement`, "keep");
						}),
					);
					expect(yield* fs.readFileString(`${root}/replacement`)).toBe("keep");
				}),
		);

		test.effect("cleans callback throws before the caller observes the defect", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const owner = yield* acquireCompilerWorkspace();
				const exit = yield* Effect.exit(
					acquireCompilerWorkspace({
						parentPath: owner.sourcePath,
						generated: () => {
							throw new Error("expected");
						},
					}),
				);
				expect(Exit.hasDies(exit)).toBe(true);
				expect(yield* fs.readDirectory(owner.sourcePath)).toEqual([]);
			}),
		);

		test.effect("cleans private-root and namespace preparation failures before staging", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const owner = yield* acquireCompilerWorkspace();
				yield* fs.writeFileString(`${owner.sourcePath}/not-directory`, "file");
				for (const operation of ["chmod", "namespace"] as const) {
					const writes: string[] = [];
					const failure = yield* Effect.flip(
						acquireCompilerWorkspace({
							jobId: operation,
							parentPath: owner.generatedPath,
							sources: [{ path: "entry.ts", contents: "must not be written" }],
						}).pipe(
							Effect.provideService(FileSystem.FileSystem, {
								...fs,
								writeFileString: (path, contents, options) => {
									writes.push(path);
									return fs.writeFileString(path, contents, options);
								},
								chmod: (path, mode) =>
									fs.chmod(
										operation === "chmod" ? `${owner.sourcePath}/not-directory/child` : path,
										mode,
									),
								makeDirectory: (path, options) =>
									fs.makeDirectory(
										operation === "namespace" && path.endsWith("/generated")
											? `${owner.sourcePath}/not-directory/child`
											: path,
										options,
									),
							}),
						),
					);
					expect(failure.reason).toBe("workspace-filesystem");
					expect(writes).toEqual([]);
					expect(yield* fs.readDirectory(owner.generatedPath)).toEqual([]);
				}
			}),
		);

		test.effect("cleans an interrupted acquisition before it publishes a handle", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const owner = yield* acquireCompilerWorkspace();
				const started = yield* Deferred.make<void>();
				const published: CompilerWorkspace[] = [];
				const fiber = yield* acquireCompilerWorkspace({
					jobId: "interrupted",
					parentPath: owner.sourcePath,
					sources: [{ path: "entry.ts", contents: "source" }],
				}).pipe(
					Effect.provideService(FileSystem.FileSystem, {
						...fs,
						writeFileString: () =>
							Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
					}),
					Effect.tap((workspace) =>
						Effect.sync(() => {
							published.push(workspace);
						}),
					),
					Effect.forkChild,
				);
				yield* Deferred.await(started);
				yield* Fiber.interrupt(fiber);
				expect(published).toEqual([]);
				expect(yield* fs.readDirectory(owner.sourcePath)).toEqual([]);
			}),
		);

		test.effect("removes supervisor-addressable workspaces after use succeeds or fails", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const owner = yield* acquireCompilerWorkspace();
				for (const jobId of ["successful-job", "failed-job"]) {
					const options = { jobId, parentPath: owner.generatedPath };
					const root = yield* Effect.fromResult(getCompilerWorkspaceRoot(path, options));
					const result = yield* Effect.scoped(
						Effect.gen(function* () {
							const workspace = yield* acquireCompilerWorkspace(options);
							expect(workspace.rootPath).toBe(root);
							if (jobId === "failed-job") {
								return yield* Effect.fail("expected failure");
							}
							return "ok";
						}),
					).pipe(Effect.result);
					expect(result).toEqual(
						jobId === "failed-job" ? Result.fail("expected failure") : Result.succeed("ok"),
					);
					expect(yield* fs.exists(root)).toBe(false);
				}
			}),
		);
	});
});

describe("worker environment", () => {
	it.effect("preserves only explicitly allowed variables", () =>
		Effect.sync(() => {
			const source = { CI: "true", TOKEN: "hidden", PATH: "/trusted/bin" };
			expect(sanitizeEnvironment({ source, preserveNames: ["CI"] })).toEqual(
				Result.succeed({ CI: "true" }),
			);
			expect(sanitizeEnvironment({ source, includePath: true })).toEqual(
				Result.succeed({ PATH: "/trusted/bin" }),
			);
			expect(sanitizeEnvironment({ source })).toEqual(Result.succeed({}));
			expect(errorReason(sanitizeEnvironment({ source, preserveNames: ["PATH"] }))).toBe(
				"invalid-input",
			);
		}),
	);
});
