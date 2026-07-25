import { BunServices } from "@effect/platform-bun";
import { it } from "@effect/vitest";
import { SANDBOX_HOST_CAPABILITIES } from "@ryot/sandbox-sdk/core";
import { Cause, Effect, Option, type Scope, FileSystem, Path } from "effect";
import { assert, describe, expect, it as vitestIt } from "vitest";

import {
	acquireSandboxScratchDirectory,
	decodeSandboxScratchManifest,
	harvestSandboxScratchChunks,
	measureSandboxScratchBytes,
	sandboxArtifactGrant,
	sandboxGrantPathError,
} from "./filesystem-grants";
import { SANDBOX_LIMITS, sandboxScratchQuotaError } from "./limits";
import { selectSandboxHostFunctions } from "./service";

const unusedHostFunction = () => Effect.die("host function must not be called");

const withTempRoot = <A, E>(
	use: (root: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-sandbox-grants-" });
		return yield* use(root);
	}).pipe(Effect.provide(BunServices.layer));

describe("sandbox filesystem grant gating", () => {
	vitestIt("treats the capability as the gate and the dispatched path as its parameter", () => {
		expect(sandboxArtifactGrant(["artifact-read"], "/tmp/root/export.zip")).toBe(
			"/tmp/root/export.zip",
		);
		expect(sandboxArtifactGrant(["artifact-read"], undefined)).toBeUndefined();
		expect(sandboxArtifactGrant(["httpCall"], "/tmp/root/export.zip")).toBeUndefined();
		expect(sandboxArtifactGrant(["artifact-read"], { history: "/tmp/root/history" })).toEqual({
			history: "/tmp/root/history",
		});
	});

	vitestIt("never binds a host function for a filesystem grant capability", () => {
		const bound = { httpCall: unusedHostFunction, scratch: unusedHostFunction };

		expect(
			Object.keys(
				selectSandboxHostFunctions(bound, {
					metadata: { kind: "script" },
					authority: { type: "system" },
					allowedHostFunctions: ["scratch", "artifact-read", "httpCall"],
				}),
			),
		).toEqual(["httpCall"]);
		expect(SANDBOX_HOST_CAPABILITIES).toContain("scratch");
		expect(SANDBOX_HOST_CAPABILITIES).toContain("artifact-read");
	});
});

describe("sandbox grant path validation", () => {
	vitestIt("rejects relative, traversing, and out-of-root paths", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const reject = (candidate: string) =>
					sandboxGrantPathError(path, "Sandbox artifact grant path", candidate, "/tmp/ryot-root");

				expect(reject("relative/export.zip")).toBe(
					"Sandbox artifact grant path must be an absolute path",
				);
				expect(reject("/tmp/ryot-root/../../etc/passwd")).toBe(
					"Sandbox artifact grant path must be a normalized path without traversal segments",
				);
				expect(reject("/etc/passwd")).toBe(
					"Sandbox artifact grant path must be inside /tmp/ryot-root",
				);
				expect(reject("/tmp/ryot-root-sibling/export.zip")).toBe(
					"Sandbox artifact grant path must be inside /tmp/ryot-root",
				);
				expect(reject("/tmp/ryot-root/nested/export.zip")).toBeNull();
			}).pipe(Effect.provide(BunServices.layer)),
		),
	);
});

describe("sandbox scratch quota", () => {
	it.effect("passes under the quota and fails the execution above it", () =>
		withTempRoot((root) =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const scratch = yield* acquireSandboxScratchDirectory(root);
				yield* fs.makeDirectory(path.join(scratch, "nested"));
				yield* fs.writeFile(path.join(scratch, "chunk-0.json"), new Uint8Array(1024));
				yield* fs.writeFile(path.join(scratch, "nested", "chunk-1.json"), new Uint8Array(2048));

				expect(yield* measureSandboxScratchBytes(scratch)).toBe(3072);
				expect(sandboxScratchQuotaError(3072)).toBeNull();

				yield* fs.writeFile(
					path.join(scratch, "chunk-2.json"),
					new Uint8Array(SANDBOX_LIMITS.scratch.totalBytes),
				);
				const usedBytes = yield* measureSandboxScratchBytes(scratch);
				expect(usedBytes).toBeGreaterThan(SANDBOX_LIMITS.scratch.totalBytes);
				expect(sandboxScratchQuotaError(usedBytes)).toBe(
					`Sandbox scratch directory uses ${usedBytes} bytes and exceeds the ${SANDBOX_LIMITS.scratch.totalBytes} byte quota`,
				);
			}),
		),
	);

	it.effect("rejects symbolic links and bounds directory depth", () =>
		withTempRoot((root) =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const scratch = yield* acquireSandboxScratchDirectory(root);
				const nested = path.join(scratch, "nested");
				const cycle = path.join(nested, "cycle");
				yield* fs.makeDirectory(nested);
				yield* fs.symlink(scratch, cycle);

				const symlinked = yield* Effect.exit(measureSandboxScratchBytes(scratch));
				assert(symlinked._tag === "Failure");
				expect(Cause.findErrorOption(symlinked.cause)).toEqual(
					Option.some(
						`Sandbox scratch entry "${cycle}" must be a regular file or directory (found SymbolicLink)`,
					),
				);
				yield* fs.remove(cycle);

				let current = scratch;
				for (let depth = 0; depth <= SANDBOX_LIMITS.scratch.maxDepth; depth += 1) {
					current = path.join(current, `level-${depth}`);
					yield* fs.makeDirectory(current);
				}
				const tooDeep = yield* Effect.exit(measureSandboxScratchBytes(scratch));
				assert(tooDeep._tag === "Failure");
				expect(Cause.findErrorOption(tooDeep.cause)).toEqual(
					Option.some(
						`Sandbox scratch directory exceeds ${SANDBOX_LIMITS.scratch.maxDepth} directory levels`,
					),
				);
			}),
		),
	);
});

describe("sandbox scratch chunk harvest", () => {
	it.effect("copies only the named chunks into kernel-owned storage", () =>
		withTempRoot((root) =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const scratch = yield* acquireSandboxScratchDirectory(root);
				const destination = path.join(root, "harvest");
				yield* fs.writeFileString(path.join(scratch, "chunk-0.json"), "[0]");
				yield* fs.writeFileString(path.join(scratch, "chunk-1.json"), "[1]");
				yield* fs.writeFileString(path.join(scratch, "leftover.tmp"), "ignored");

				const chunkPaths = yield* harvestSandboxScratchChunks({
					destination,
					scratchDirectory: scratch,
					chunkFiles: ["chunk-0.json", "chunk-1.json"],
				});

				const [firstChunkPath] = chunkPaths;
				assert(firstChunkPath !== undefined);
				expect(chunkPaths).toEqual([
					path.join(destination, "chunk-0.json"),
					path.join(destination, "chunk-1.json"),
				]);
				expect(yield* fs.readFileString(firstChunkPath)).toBe("[0]");
				expect((yield* fs.readDirectory(destination)).sort()).toEqual([
					"chunk-0.json",
					"chunk-1.json",
				]);
			}),
		),
	);

	it.effect("fails on a manifest naming a missing or escaping chunk", () =>
		withTempRoot((root) =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const scratch = yield* acquireSandboxScratchDirectory(root);
				const destination = path.join(root, "harvest");
				yield* fs.writeFileString(path.join(root, "outside.json"), "[9]");

				const missing = yield* Effect.exit(
					harvestSandboxScratchChunks({
						destination,
						scratchDirectory: scratch,
						chunkFiles: ["chunk-0.json"],
					}),
				);
				assert(missing._tag === "Failure");
				expect(Cause.findErrorOption(missing.cause)).toEqual(
					Option.some('Sandbox scratch manifest names a missing chunk file "chunk-0.json"'),
				);

				const escaping = yield* Effect.exit(
					harvestSandboxScratchChunks({
						destination,
						scratchDirectory: scratch,
						chunkFiles: ["../outside.json"],
					}),
				);
				assert(escaping._tag === "Failure");
				expect(Cause.findErrorOption(escaping.cause)).toEqual(
					Option.some(
						'Sandbox scratch manifest entry "../outside.json" escapes the scratch directory',
					),
				);
			}),
		),
	);

	it.effect("rejects symlinked chunk sources before copying", () =>
		withTempRoot((root) =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const scratch = yield* acquireSandboxScratchDirectory(root);
				const destination = path.join(root, "harvest");
				const outside = path.join(root, "outside.json");
				const source = path.join(scratch, "chunk-0.json");
				yield* fs.writeFileString(outside, "secret");
				yield* fs.symlink(outside, source);

				const result = yield* Effect.exit(
					harvestSandboxScratchChunks({
						destination,
						scratchDirectory: scratch,
						chunkFiles: ["chunk-0.json"],
					}),
				);
				assert(result._tag === "Failure");
				expect(Cause.findErrorOption(result.cause)).toEqual(
					Option.some(`Sandbox scratch entry "${source}" must not be a symbolic link`),
				);
				expect(yield* fs.exists(path.join(destination, "chunk-0.json"))).toBe(false);
			}),
		),
	);

	it.effect("rejects duplicate manifest entries before publishing chunks", () =>
		withTempRoot((root) =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const scratch = yield* acquireSandboxScratchDirectory(root);
				const destination = path.join(root, "harvest");
				yield* fs.writeFileString(path.join(scratch, "chunk-0.json"), "[]");

				const result = yield* Effect.exit(
					harvestSandboxScratchChunks({
						destination,
						scratchDirectory: scratch,
						chunkFiles: ["chunk-0.json", "chunk-0.json"],
					}),
				);
				assert(result._tag === "Failure");
				expect(Cause.findErrorOption(result.cause)).toEqual(
					Option.some('Sandbox scratch manifest contains duplicate chunk file "chunk-0.json"'),
				);
				expect(yield* fs.exists(destination)).toBe(false);
			}),
		),
	);

	vitestIt("harvests only when the returned value carries a chunk manifest", () => {
		expect(decodeSandboxScratchManifest({ chunkFiles: ["chunk-0.json"], groups: 12 })).toEqual(
			Option.some({ chunkFiles: ["chunk-0.json"] }),
		);
		expect(Option.isNone(decodeSandboxScratchManifest({ groups: 12 }))).toBe(true);
		expect(Option.isNone(decodeSandboxScratchManifest(null))).toBe(true);
	});
});

describe("sandbox scratch cleanup", () => {
	it.effect("removes the scratch directory when the execution scope closes cleanly", () =>
		withTempRoot((root) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const scratch = yield* Effect.scoped(
					acquireSandboxScratchDirectory(root).pipe(
						Effect.tap((directory) => fs.writeFileString(`${directory}/chunk-0.json`, "[0]")),
					),
				);

				expect(yield* fs.exists(scratch)).toBe(false);
			}),
		),
	);

	it.effect("removes the scratch directory when the execution fails or dies", () =>
		withTempRoot((root) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const captured: string[] = [];
				// A quota rejection, a script failure, and a killed process all leave the same scope
				// abnormally; cleanup must not depend on which one happened.
				const runAborted = (abort: Effect.Effect<never, string>) =>
					Effect.scoped(
						acquireSandboxScratchDirectory(root).pipe(
							Effect.tap((directory) => Effect.sync(() => captured.push(directory))),
							Effect.andThen(abort),
						),
					).pipe(Effect.exit);

				yield* runAborted(Effect.fail("scratch quota exceeded"));
				yield* runAborted(Effect.die("sandbox process killed"));

				expect(captured).toHaveLength(2);
				for (const directory of captured) {
					expect(yield* fs.exists(directory)).toBe(false);
				}
			}),
		),
	);
});
