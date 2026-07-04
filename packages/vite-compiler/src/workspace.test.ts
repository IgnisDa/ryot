import { join } from "node:path";

import { BunFileSystem } from "@effect/platform-bun";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Result } from "effect";

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

	it.effect("rejects traversal in a supervisor job identity", () =>
		Effect.sync(() => {
			expect(
				errorReason(getCompilerWorkspaceRoot({ jobId: "../other", parentPath: "/tmp/jobs" })),
			).toBe("invalid-input");
		}),
	);

	it.effect("rejects collisions and unsupported input before writing files", () =>
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

			const unsupported = yield* Effect.flip(
				stageSourceFiles(workspace, [
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					{ contents: 1, path: "bad.ts" } as never,
				]),
			);
			expect(unsupported.reason).toBe("invalid-input");
		}).pipe(Effect.provide(BunFileSystem.layer)),
	);

	it.effect("preserves deterministic paths in separate source and generated namespaces", () =>
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
