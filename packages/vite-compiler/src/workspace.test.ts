import { BunFileSystem, BunPath } from "@effect/platform-bun";
import { describe, expect, it, layer } from "@effect/vitest";
import { Context, Effect, FileSystem, Layer, Path, Ref, Result } from "effect";

import {
	acquireCompilerWorkspace,
	getCompilerWorkspaceRoot,
	sanitizeEnvironment,
	stageGeneratedFiles,
	stageSourceFiles,
	validateRelativePath,
} from "./index";
import type { ViteCompilerError } from "./index";

const errorReason = <Value>(result: Result.Result<Value, ViteCompilerError>) =>
	Result.isFailure(result) ? result.failure.reason : undefined;

class RemovedPaths extends Context.Service<RemovedPaths, Ref.Ref<ReadonlyArray<string>>>()(
	"test/RemovedPaths",
) {}

const virtualFileSystemLayer = Layer.effectContext(
	Effect.gen(function* () {
		const removed = yield* Ref.make<ReadonlyArray<string>>([]);
		return Context.make(
			FileSystem.FileSystem,
			FileSystem.makeNoop({
				makeDirectory: () => Effect.void,
				makeTempDirectory: () => Effect.succeed("/virtual/job"),
				remove: (path) => Ref.update(removed, (paths) => [...paths, path]),
			}),
		).pipe(Context.add(RemovedPaths, removed));
	}),
);

const liveLayer = Layer.merge(BunFileSystem.layer, BunPath.layer);

describe("compiler workspace", () => {
	it.effect.each([
		"/absolute.ts",
		"../escape.ts",
		"nested/../../escape.ts",
		"C:\\escape.ts",
		"a\\b.ts",
		"a//b.ts",
	])("rejects unsafe path %s", (path) =>
		Effect.sync(() => expect(errorReason(validateRelativePath(path))).toBe("invalid-input")),
	);

	layer(BunPath.layer)((test) =>
		test.effect("rejects traversal in a supervisor job identity", () =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				expect(
					errorReason(
						getCompilerWorkspaceRoot(path, { jobId: "../other", parentPath: "/tmp/jobs" }),
					),
				).toBe("invalid-input");
			}),
		),
	);

	layer(liveLayer)((test) => {
		test.effect("rejects collisions before writing files", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const workspace = yield* acquireCompilerWorkspace();
				const duplicate = yield* Effect.flip(
					stageSourceFiles(workspace, [
						{ path: "same.ts", contents: "first" },
						{ path: "same.ts", contents: "second" },
					]),
				);
				expect(duplicate.reason).toBe("workspace-collision");
				expect(yield* fs.exists(path.join(workspace.sourcePath, "same.ts"))).toBe(false);

				yield* stageSourceFiles(workspace, [{ path: "existing.ts", contents: "existing" }]);
				const existing = yield* Effect.flip(
					stageSourceFiles(workspace, [
						{ contents: "new", path: "a-new.ts" },
						{ path: "existing.ts", contents: "replacement" },
					]),
				);
				expect(existing.reason).toBe("workspace-collision");
				expect(yield* fs.exists(path.join(workspace.sourcePath, "a-new.ts"))).toBe(false);
			}),
		);
	});

	layer(liveLayer)((test) => {
		test.effect("preserves deterministic paths in separate source and generated namespaces", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const workspace = yield* acquireCompilerWorkspace();
				const staged = yield* stageSourceFiles(workspace, [
					{ contents: "z", path: "nested/z.ts" },
					{ path: "a.ts", contents: new TextEncoder().encode("a") },
				]);
				yield* stageGeneratedFiles(workspace, [{ path: "a.ts", contents: "generated" }]);
				expect(staged).toEqual(["a.ts", "nested/z.ts"]);
				expect(yield* fs.readFileString(path.join(workspace.sourcePath, "a.ts"))).toBe("a");
				expect(yield* fs.readFileString(path.join(workspace.sourcePath, "nested/z.ts"))).toBe("z");
				expect(yield* fs.readFileString(path.join(workspace.generatedPath, "a.ts"))).toBe(
					"generated",
				);
				expect(workspace.outputPath).toBe(path.join(workspace.rootPath, "output"));
			}),
		);
	});

	layer(liveLayer)((test) => {
		test.effect("rejects a filesystem symlink without partially staging earlier paths", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const workspace = yield* acquireCompilerWorkspace();
				yield* fs.makeDirectory(path.join(workspace.sourcePath, "nested"));
				yield* fs.symlink(workspace.generatedPath, path.join(workspace.sourcePath, "nested/link"));
				const failure = yield* Effect.flip(
					stageSourceFiles(workspace, [
						{ path: "a.ts", contents: "must not be staged" },
						{ contents: "no", path: "nested/link/escape.ts" },
					]),
				);
				expect(failure.reason).toBe("workspace-symlink");
				expect(yield* fs.exists(path.join(workspace.sourcePath, "a.ts"))).toBe(false);
			}),
		);
	});

	layer(Layer.merge(virtualFileSystemLayer, BunPath.layer))((test) => {
		test.effect("releases the workspace through its owning scope with an injected filesystem", () =>
			Effect.gen(function* () {
				yield* Effect.scoped(acquireCompilerWorkspace());
				expect(yield* Ref.get(yield* RemovedPaths)).toEqual(["/virtual/job"]);
			}),
		);
	});

	layer(liveLayer)((test) => {
		test.effect("removes a supervisor-addressable workspace after success and failure", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const owner = yield* acquireCompilerWorkspace();
				for (const jobId of ["successful-job", "failed-job"]) {
					const options = { jobId, parentPath: owner.generatedPath };
					const root = yield* Effect.fromResult(getCompilerWorkspaceRoot(path, options));
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
