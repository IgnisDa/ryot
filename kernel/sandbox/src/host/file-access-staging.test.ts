import { BunServices } from "@effect/platform-bun";
import { layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Path } from "effect";
import { Base64 } from "effect/encoding";
import { expect } from "vitest";

import { MiB, SANDBOX_LIMITS } from "../protocol/limits";
import { ExecutionFileStaging } from "./execution-file-staging";
import { ExecutionFileStore } from "./execution-files";
import { ExecutionFiles, type SandboxFileAccess } from "./file-access";
import { makeSandboxHostConfigLayer } from "./host.test-support";
import type { SandboxRunInput } from "./invocation";
import { makeUserRunInput } from "./run-input.test-support";

const makeHarvestFixture = Effect.fnUntraced(function* (
	stage: (outputs: ReadonlyArray<Uint8Array>) => Effect.Effect<string[], SandboxRunError>,
) {
	const realFs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const root = yield* realFs.makeTempDirectoryScoped({ prefix: "ryot-harvest-bytes-" });
	const prepared: SandboxRunInput[] = [];
	const writes: string[] = [];
	const directories: string[] = [];
	const opened: string[] = [];
	const control: { read: "normal" | "fail-second" | "block-second" } = { read: "normal" };
	const readStarted = yield* Deferred.make<void>();
	const fs: FileSystem.FileSystem = {
		...realFs,
		writeFile: (target, bytes, options) =>
			realFs.writeFile(target, bytes, options).pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						writes.push(target);
					}),
				),
			),
		makeTempDirectory: (options) =>
			realFs.makeTempDirectory(options).pipe(
				Effect.tap((directory) =>
					Effect.sync(() => {
						directories.push(directory);
					}),
				),
			),
		open: (target, options) =>
			Effect.gen(function* () {
				opened.push(target);
				if (path.basename(target) === "second.bin") {
					if (control.read === "fail-second") {
						return yield* realFs.open(path.join(root, "missing"), options);
					}
					if (control.read === "block-second") {
						yield* Deferred.succeed(readStarted, undefined);
						return yield* Effect.never;
					}
				}
				return yield* realFs.open(target, options);
			}),
	};
	const context = yield* Layer.build(
		Layer.effect(ExecutionFiles, ExecutionFiles.make).pipe(
			Layer.provide(ExecutionFileStore.layer),
			Layer.provide(Layer.succeed(FileSystem.FileSystem, fs)),
			Layer.provide(
				Layer.succeed(ExecutionFileStaging, {
					prepare: (input) =>
						Effect.sync(() => {
							prepared.push(input);
							return stage;
						}),
				}),
			),
			Layer.provide(makeSandboxHostConfigLayer({ tempDirectory: root })),
		),
	);
	const service = Context.get(context, ExecutionFiles);
	const input = makeUserRunInput({
		workflowExecutionId: "child-workflow",
		grants: { artifactOwnerExecutionId: "trusted-parent" },
		principal: { metadata: { runtimeImports: [], capabilities: ["scratch"] } },
	});
	const files = yield* service.open(input);
	return { root, files, input, writes, opened, control, prepared, directories, readStarted };
});

const writeOutput = Effect.fnUntraced(function* (
	files: SandboxFileAccess,
	name: string,
	bytes: Uint8Array,
) {
	if (bytes.length === 0) {
		yield* files.scratchWrite({ name, data: "", offset: 0, final: true });
	}
	for (let offset = 0; offset < bytes.length; offset += SANDBOX_LIMITS.scratch.chunkBytes) {
		const end = Math.min(bytes.length, offset + SANDBOX_LIMITS.scratch.chunkBytes);
		yield* files.scratchWrite({
			name,
			offset,
			final: end === bytes.length,
			data: Base64.encode(bytes.subarray(offset, end)),
		});
	}
});

layer(BunServices.layer)((test) => {
	test.effect("hands the full bounded batch to staging in manifest order without temp copies", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const first = new Uint8Array(4 * MiB).fill(1);
				const second = new Uint8Array(MiB).fill(2);
				let batches = 0;
				const fixture = yield* makeHarvestFixture((outputs) =>
					Effect.sync(() => {
						batches++;
						expect(outputs.map((bytes) => bytes.byteLength)).toEqual([MiB, 0, 4 * MiB]);
						expect(outputs.map(sha256Hex)).toEqual([
							sha256Hex(second),
							sha256Hex(new Uint8Array()),
							sha256Hex(first),
						]);
						return ["second-handle", "empty-handle", "first-handle"];
					}),
				);
				yield* writeOutput(fixture.files, "first.bin", first);
				yield* writeOutput(fixture.files, "second.bin", second);
				yield* writeOutput(fixture.files, "empty.bin", new Uint8Array());
				const writesBeforeHarvest = [...fixture.writes];
				expect(
					yield* fixture.files.harvest({ chunkFiles: ["second.bin", "empty.bin", "first.bin"] }),
				).toEqual({ chunkHandles: ["second-handle", "empty-handle", "first-handle"] });
				expect(fixture.prepared).toEqual([fixture.input]);
				expect(fixture.writes).toEqual(writesBeforeHarvest);
				expect(fixture.directories).toHaveLength(1);
				expect(fixture.opened.map((target) => target.split("/").at(-1))).toEqual([
					"second.bin",
					"empty.bin",
					"first.bin",
				]);
				expect(yield* fs.readDirectory(fixture.root)).toEqual(["ryot-sandbox-artifacts"]);
				expect(yield* fixture.files.harvest({ chunkFiles: [] })).toBeNull();
				expect(batches).toBe(1);
			}),
		),
	);

	test.effect("publishes nothing when a later pinned read fails or is interrupted", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				for (const mode of ["fail-second", "block-second"] as const) {
					const fixture = yield* makeHarvestFixture(() => Effect.die("Unexpected staging"));
					yield* writeOutput(fixture.files, "first.bin", new Uint8Array([1]));
					yield* writeOutput(fixture.files, "second.bin", new Uint8Array([2]));
					fixture.control.read = mode;
					const harvest = fixture.files.harvest({ chunkFiles: ["first.bin", "second.bin"] });
					if (mode === "fail-second") {
						expect(Exit.isFailure(yield* Effect.exit(harvest))).toBe(true);
					} else {
						const fiber = yield* Effect.forkChild(harvest);
						yield* Deferred.await(fixture.readStarted);
						yield* Fiber.interrupt(fiber);
						expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
					}
					expect(fixture.prepared).toEqual([]);
					expect(yield* fs.readDirectory(fixture.root)).toEqual(["ryot-sandbox-artifacts"]);
					expect(yield* fixture.files.harvest({ chunkFiles: [] })).toBeNull();
				}
			}),
		),
	);

	test.effect(
		"cleans scratch without returning partial handles on a second sink failure or interrupt",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					for (const interrupt of [false, true]) {
						const attempted: number[] = [];
						const fixture = yield* makeHarvestFixture((outputs) =>
							Effect.forEach(outputs, (_bytes, index) => {
								attempted.push(index);
								if (index === 1) {
									return interrupt
										? Effect.interrupt
										: Effect.fail(
												new SandboxRunError({ kind: "infrastructure", message: "Sink failed" }),
											);
								}
								return Effect.succeed(`handle-${index}`);
							}),
						);
						yield* writeOutput(fixture.files, "first.bin", new Uint8Array([1]));
						yield* writeOutput(fixture.files, "second.bin", new Uint8Array([2]));
						expect(
							Exit.isFailure(
								yield* Effect.exit(
									fixture.files.harvest({ chunkFiles: ["first.bin", "second.bin"] }),
								),
							),
						).toBe(true);
						expect(attempted).toEqual([0, 1]);
						expect(yield* fs.readDirectory(fixture.root)).toEqual(["ryot-sandbox-artifacts"]);
					}
				}),
			),
	);
});
