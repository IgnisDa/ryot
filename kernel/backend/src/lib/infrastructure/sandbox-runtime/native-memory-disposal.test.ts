import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError, TimeoutError } from "@ryot-app/contract/errors";
import type { WorkflowReplayJournalEntry } from "@ryot-app/sandbox-sdk/workflow";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import {
	Cause,
	Deferred,
	Effect,
	Exit,
	Fiber,
	FileSystem,
	Option,
	Path,
	Queue,
	Schema,
} from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { testExecutionId } from "#lib/test-utils/redis";
import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

import { hostCallArgs } from "./host-call-args.test-support";
import { SANDBOX_TRANSIENT_MEMORY, SandboxHostCallGate } from "./host-call-gate";
import { SANDBOX_LIMITS } from "./limits";
import { NativeMemoryEvidence, nativeMemoryLayer } from "./native-memory-disposal.test-support";
import { makeRunnerInput } from "./runner-native.test-support";
import { SandboxService } from "./service";
import { SandboxSidecarAdmission } from "./sidecar-admission";
import { SidecarHostCallFrame } from "./sidecar-protocol";
import { trackNativeKeys } from "./sidecar-recovery-native.test-support";
import { SandboxSidecarSupervisor } from "./sidecar-supervisor";

const MiB = 1024 * 1024;
const token = '"\\\n漢🙂';
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodedTokenBytes = new TextEncoder().encode(encodeJson(token)).byteLength - 2;
const externalBytes = SANDBOX_LIMITS.isolate.externalBytes;
const journalEntries = 22;
const tokenRepetitions = Math.floor((4.5 * MiB) / encodedTokenBytes);
const unusedSettlement = () => Effect.die("Committed journal replay must not settle inline");
const definition = (run: string, imports = "") => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
${imports}
export const manifest = defineManifest({ kind: "script", name: "Native memory disposal", slug: "native-memory-disposal" });
export default defineScript({ manifest, input: Schema.Struct({ mode: Schema.String }), output: Schema.Unknown, run: ${run} });
`;

const journalSource = definition(`(_input, host) => Effect.gen(function* () {
  Reflect.set(globalThis, "nativeMemoryState", "journal");
  const token = ${encodeJson(token)};
  const repeat = String.prototype.repeat;
  const slice = String.prototype.slice;
  const repeated = repeat.call(token, ${tokenRepetitions});
  const repeatedLength = repeated.length;
  const summarize = (value: unknown) => {
    if (typeof value !== "string") throw new Error("Expected a recorded string");
    if (value.length < repeatedLength || slice.call(value, 0, repeatedLength) !== repeated) {
      throw new Error("Recorded escaped token sequence is corrupt");
    }
    const padding = slice.call(value, repeatedLength);
    if (padding !== repeat.call("x", padding.length)) throw new Error("Recorded padding is corrupt");
    return {
      length: value.length, padding: padding.length,
      first: slice.call(value, 0, token.length),
      lastToken: slice.call(value, repeatedLength - token.length, repeatedLength),
      last: slice.call(value, -token.length),
    };
  };
  const first = yield* Effect.all([0, 1, 2].map(i => host.getCachedValue("entry-" + i).pipe(Effect.map(summarize))), { concurrency: 3 });
  const rest = [];
  for (let i = 3; i < ${journalEntries}; i++) rest.push(summarize(yield* host.getCachedValue("entry-" + i)));
  return [...first, ...rest];
})`);

const fileSource = definition(
	`(input) => Effect.gen(function* () {
  Reflect.set(globalThis, "nativeMemoryState", "file");
  if (input.mode === "scratch-overflow") {
    yield* writeScratchChunks([{ name: "overflow.bin", contents: new Uint8Array(5 * 1024 * 1024 + 1) }]);
    return null;
  }
  if (input.mode === "scratch-cancel") {
    yield* writeScratchChunks([{ name: "cancel.bin", contents: new Uint8Array(5 * 1024 * 1024) }]);
    return yield* Effect.never;
  }
  const summarize = (bytes: Uint8Array) => {
    let chunks = 0;
    for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
      chunks++;
      const end = Math.min(offset + 1024 * 1024, bytes.length);
      if (bytes[offset] !== chunks ||
          (end - offset > 1 && bytes[end - 1] !== 173) ||
          (end - offset > 2 && bytes[offset + 1] !== 173)) {
        throw new Error("Artifact chunk boundary is corrupt");
      }
    }
    return { length: bytes.length, chunks };
  };
  if (input.mode === "parallel") {
    return yield* Effect.all([readArtifact, readNamedArtifact("second")].map(read => read.pipe(Effect.map(summarize))), { concurrency: 2 });
  }
  return summarize(yield* readArtifact);
})`,
	'import { readArtifact, readNamedArtifact, writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";',
);

const exitSource = definition(
	`(input, host) => Effect.gen(function* () {
  Reflect.set(globalThis, "nativeMemoryState", input.mode);
  yield* writeScratchChunks([{ name: "discard.bin", contents: new Uint8Array(256 * 1024).fill(7) }]);
  if (input.mode === "success") return "finished";
  if (input.mode === "failure") return yield* Effect.fail({ message: "expected disposal failure" });
  if (input.mode === "timeout") return yield* Effect.sleep("35 seconds").pipe(Effect.as("too late"));
  return yield* host.getCachedValue(input.mode);
})`,
	'import { writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";',
);

const freshSource = definition(
	'() => Effect.succeed(String(Reflect.get(globalThis, "nativeMemoryState") ?? "fresh"))',
);

const request = (index: number) => ({
	index,
	kind: "host" as const,
	name: "getCachedValue",
	args: { args: [`entry-${index}`], capability: "getCachedValue" as const },
});

const artifactBytes = (size: number) => {
	const bytes = new Uint8Array(size).fill(173);
	for (let offset = 0; offset < size; offset += MiB) {
		bytes[offset] = offset / MiB + 1;
	}
	return bytes;
};

const lateHostCall = (handle: string, generation: number) =>
	Schema.decodeSync(SidecarHostCallFrame)({
		handle,
		seq: 2000,
		generation,
		type: "hostCall",
		name: "journalRead",
		args: hostCallArgs({ offset: 0, length: 1 }),
	});

const assertDisposed = Effect.fnUntraced(function* (executionId: string) {
	const evidence = yield* NativeMemoryEvidence;
	const admission = yield* SandboxSidecarAdmission;
	const supervisor = yield* SandboxSidecarSupervisor;
	const fs = yield* FileSystem.FileSystem;
	const run = evidence.runs.get(executionId);
	assert(run !== undefined);
	expect(run.limits.heapBytes).toBe(SANDBOX_LIMITS.isolate.heapBytes);
	expect(run.limits.externalBytes).toBe(externalBytes);
	expect(evidence.retired.has(run.handle)).toBe(true);
	expect(evidence.done.has(run.handle)).toBe(true);
	const gate = evidence.registrations.get(run.handle);
	assert(gate !== undefined);
	expect(yield* gate.scriptBudget).toMatchObject({ remainingMs: 0 });
	expect(gate.inlineEntries()).toEqual([]);
	const late = yield* gate.dispatch(lateHostCall(run.handle, run.generation));
	expect(late.result).toMatchObject({
		status: "success",
		value: { success: false, error: "Sandbox execution is no longer active" },
	});
	expect(evidence.activeFiles.size).toBe(0);
	expect(evidence.activeHosts.size).toBe(0);
	const files = evidence.files.get(executionId);
	assert(files !== undefined);
	if (files.filesystem.artifact) {
		const closedRead = yield* Effect.exit(files.artifactReadRange({ offset: 0, length: 1 }));
		assert(Exit.isFailure(closedRead));
	}
	expect(admission.snapshot()).toMatchObject({
		runs: 0,
		waiting: 0,
		bytes: 256 * MiB + SANDBOX_TRANSIENT_MEMORY.poolBytes,
	});
	expect((yield* SandboxHostCallGate).transientMemory()).toEqual({ used: 0, waiting: 0 });
	expect(supervisor.snapshot()).toMatchObject({ activeExecutions: 0 });
	expect(
		(yield* fs.readDirectory(evidence.root)).filter(
			(name) =>
				name.startsWith("ryot-sandbox-scratch-") || name.startsWith("ryot-sandbox-harvest-"),
		),
	).toEqual([]);
	evidence.registrations.delete(run.handle);
	evidence.files.delete(executionId);
});

const nextCall = Effect.fnUntraced(function* (
	executionId: string,
	name: string,
	minimumOffset = 0,
) {
	const evidence = yield* NativeMemoryEvidence;
	for (;;) {
		const event = yield* Queue.take(evidence.events);
		if (event.name !== name || event.handle !== evidence.runs.get(executionId)?.handle) {
			continue;
		}
		const call = evidence.calls.findLast(
			(item) => item.handle === event.handle && item.name === name,
		);
		assert(call !== undefined);
		const args = call.args;
		if (isObjectRecord(args)) {
			const offset = args["offset"];
			if (typeof offset === "number" && offset >= minimumOffset) {
				return;
			}
		}
	}
});

layer(nativeMemoryLayer, { excludeTestServices: true })((test) => {
	test.effect("journal_reads_preserve_large_pinned_prefixes_with_bounded_frames", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const service = yield* SandboxService;
				const evidence = yield* NativeMemoryEvidence;
				const track = yield* trackNativeKeys;
				const compiled = yield* compiler.compile(journalSource);
				const value = token.repeat(tokenRepetitions);
				const journal: WorkflowReplayJournalEntry[] = Array.from(
					{ length: journalEntries },
					(_, index) => ({ request: request(index), value: { value, state: "success" } }),
				);
				const last = journal.at(-1);
				assert(last !== undefined);
				const remaining =
					SANDBOX_LIMITS.journalBytes - new TextEncoder().encode(encodeJson(journal)).byteLength;
				journal[journalEntries - 1] = {
					...last,
					value: { state: "success", value: value + "x".repeat(remaining) },
				};
				const expected = [
					...Array.from({ length: journalEntries - 1 }, () => ({
						padding: 0,
						last: token,
						first: token,
						lastToken: token,
						length: value.length,
					})),
					{
						first: token,
						lastToken: token,
						padding: remaining,
						last: "x".repeat(token.length),
						length: value.length + remaining,
					},
				];
				const inputs = [0, 1].map((index) =>
					makeRunnerInput(
						compiled,
						{ mode: "journal" },
						{
							replayJournal: journal,
							workflowExecutionId: `native-memory-parent-${index}`,
							executionId: testExecutionId(`native-memory-journal-${index}`),
							inlineDurableHost: { settle: unusedSettlement, capabilities: ["getCachedValue"] },
						},
					),
				);
				for (const input of inputs) {
					yield* track(input);
				}
				const results = yield* Effect.forEach(inputs, (input) => service.run(input), {
					concurrency: 2,
				});
				for (const [index, result] of results.entries()) {
					expect(result).toMatchObject({
						inline: [],
						error: null,
						success: true,
						value: { output: expected, state: "completed", journalLength: journalEntries },
					});
					const input = inputs[index];
					assert(input !== undefined);
					const run = evidence.runs.get(input.executionId);
					assert(run !== undefined);
					const gate = evidence.registrations.get(run.handle);
					assert(gate?.journal !== undefined);
					expect(gate.journal.totalBytes + journalEntries + 1).toBe(SANDBOX_LIMITS.journalBytes);
					const calls = evidence.calls.filter((call) => call.handle === run.handle);
					expect(calls.length).toBeGreaterThan(100);
					expect(calls.every((call) => call.name === "journalRead")).toBe(true);
					const ranges = evidence.ranges.filter((range) => range.handle === run.handle);
					expect(ranges.reduce((total, range) => total + range.bytes, 0)).toBe(
						gate.journal.totalBytes,
					);
					expect(ranges.every((range) => range.bytes > 0 && range.bytes <= MiB)).toBe(true);
					const offsets = ranges.slice(0, 3).map((range) => range.offset);
					expect(new Set(offsets)).toEqual(new Set(gate.journal.offsets.slice(0, 3)));
					yield* assertDisposed(input.executionId);
				}
				expect(evidence.reservations.some((snapshot) => snapshot.runs === 2)).toBe(true);
				expect(evidence.reservations.every((snapshot) => snapshot.bytes <= snapshot.budget)).toBe(
					true,
				);
			}),
		),
	);

	test.effect("journal_reassembly_failures_and_interruption_release_native_reservations", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const service = yield* SandboxService;
				const evidence = yield* NativeMemoryEvidence;
				const track = yield* trackNativeKeys;
				const compiled = yield* compiler.compile(
					definition(`(_input, host) => Effect.gen(function* () {
  Reflect.set(globalThis, "nativeMemoryState", "oversized-journal");
  const values = yield* Effect.all([0, 1, 2].map(i => host.getCachedValue("entry-" + i)), { concurrency: 3 });
  return values.map(value => typeof value === "string" ? value.length : -1);
})`),
				);
				const fresh = yield* compiler.compile(freshSource);
				for (const [label, size, cancel] of [
					["individual", externalBytes + MiB, false],
					["concurrent", externalBytes / 2, false],
					["interrupted", externalBytes / 4, true],
				] as const) {
					const journal: WorkflowReplayJournalEntry[] = Array.from({ length: 3 }, (_, index) => ({
						request: request(index),
						value: {
							state: "success",
							value: "x".repeat(index === 0 || label !== "individual" ? size : 1),
						},
					}));
					const input = makeRunnerInput(
						compiled,
						{ mode: label },
						{
							replayJournal: journal,
							workflowExecutionId: `native-memory-parent-${label}`,
							executionId: testExecutionId(`native-memory-journal-${label}`),
							inlineDurableHost: { settle: unusedSettlement, capabilities: ["getCachedValue"] },
						},
					);
					yield* track(input);
					if (cancel) {
						const fiber = yield* Effect.forkChild(service.run(input));
						yield* nextCall(input.executionId, "journalRead", MiB);
						yield* Fiber.interrupt(fiber);
						const exit = yield* Fiber.await(fiber);
						assert(Exit.isFailure(exit));
						expect(Cause.hasInterrupts(exit.cause)).toBe(true);
					} else {
						const exit = yield* Effect.exit(service.run(input));
						assertExitFails(
							exit,
							new SandboxRunError({
								kind: "script-failure",
								message: `ArrayBuffer limit of ${externalBytes} bytes exceeded`,
							}),
						);
						expect(
							evidence.done.get(evidence.runs.get(input.executionId)?.handle ?? ""),
						).toMatchObject({ status: "limit", limit: "external" });
					}
					const handle = evidence.runs.get(input.executionId)?.handle;
					expect(
						evidence.calls
							.filter((call) => call.handle === handle)
							.every((call) => call.name === "journalRead"),
					).toBe(true);
					yield* assertDisposed(input.executionId);
					const neighbour = makeRunnerInput(
						fresh,
						{ mode: "fresh" },
						{ executionId: testExecutionId(`native-memory-fresh-${label}`) },
					);
					yield* track(neighbour);
					expect(yield* service.run(neighbour)).toMatchObject({ success: true, value: "fresh" });
					yield* assertDisposed(neighbour.executionId);
				}
			}),
		),
	);

	test.effect("whole_artifact_assembly_uses_reserved_native_memory_and_releases_failed_reads", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const service = yield* SandboxService;
				const evidence = yield* NativeMemoryEvidence;
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const track = yield* trackNativeKeys;
				const compiled = yield* compiler.compile(fileSource);
				const artifactPath = path.join(evidence.root, "whole.bin");
				for (const size of [
					MiB - 1,
					MiB,
					MiB + 1,
					externalBytes - 4 * MiB,
					externalBytes,
					externalBytes + 1,
				]) {
					yield* fs.writeFile(artifactPath, artifactBytes(size));
					const input = {
						...makeRunnerInput(
							compiled,
							{ mode: "whole" },
							{ executionId: testExecutionId(`native-memory-artifact-${size}`) },
						),
						grants: { artifactPath },
					};
					yield* track(input);
					if (size === externalBytes) {
						assertExitFails(
							yield* Effect.exit(service.run(input)),
							new SandboxRunError({
								kind: "script-failure",
								message: `ArrayBuffer limit of ${externalBytes} bytes exceeded`,
							}),
						);
						yield* assertDisposed(input.executionId);
						continue;
					}
					const result = yield* service.run(input);
					if (size > externalBytes) {
						expect(result).toMatchObject({
							value: null,
							success: false,
							error: {
								phase: "execute",
								message: "Sandbox artifact exceeds its reserved isolate memory",
							},
						});
					} else {
						expect(result).toMatchObject({
							error: null,
							success: true,
							value: { length: size, chunks: Math.ceil(size / MiB) },
						});
						const handle = evidence.runs.get(input.executionId)?.handle;
						const calls = evidence.calls.filter((call) => call.handle === handle);
						expect(calls.every((call) => call.name === "artifactReadRange")).toBe(true);
						expect(calls.length).toBe(Math.ceil(size / MiB));
					}
					yield* assertDisposed(input.executionId);
				}
				yield* fs.writeFile(artifactPath, artifactBytes(6 * MiB + 1));
				const parallel = {
					...makeRunnerInput(
						compiled,
						{ mode: "parallel" },
						{ executionId: testExecutionId("native-memory-parallel-artifacts") },
					),
					grants: { artifactPath, namedArtifactPaths: { second: artifactPath } },
				};
				yield* track(parallel);
				expect(yield* service.run(parallel)).toMatchObject({
					success: true,
					value: Array.from({ length: 2 }, () => ({ chunks: 7, length: 6 * MiB + 1 })),
				});
				const parallelCalls = evidence.calls.filter(
					(call) => call.handle === evidence.runs.get(parallel.executionId)?.handle,
				);
				expect(parallelCalls.slice(0, 2).map((call) => call.args)).toEqual([
					{ offset: 0, length: MiB },
					{ offset: 0, length: MiB, key: "second" },
				]);
				yield* assertDisposed(parallel.executionId);
				yield* fs.writeFile(artifactPath, artifactBytes(externalBytes / 2 + MiB));
				const exhausted = {
					...parallel,
					executionId: testExecutionId("native-memory-concurrent-artifact-exhaustion"),
				};
				yield* track(exhausted);
				assertExitFails(
					yield* Effect.exit(service.run(exhausted)),
					new SandboxRunError({
						kind: "script-failure",
						message: `ArrayBuffer limit of ${externalBytes} bytes exceeded`,
					}),
				);
				yield* assertDisposed(exhausted.executionId);
				const interrupted = {
					...makeRunnerInput(
						compiled,
						{ mode: "whole" },
						{ executionId: testExecutionId("native-memory-interrupted-artifact") },
					),
					grants: { artifactPath },
				};
				yield* track(interrupted);
				const fiber = yield* Effect.forkChild(service.run(interrupted));
				yield* nextCall(interrupted.executionId, "artifactReadRange", MiB);
				yield* Fiber.interrupt(fiber);
				const exit = yield* Fiber.await(fiber);
				assert(Exit.isFailure(exit));
				expect(Cause.hasInterrupts(exit.cause)).toBe(true);
				yield* assertDisposed(interrupted.executionId);
				const fresh = yield* compiler.compile(freshSource);
				const neighbour = makeRunnerInput(
					fresh,
					{ mode: "fresh" },
					{ executionId: testExecutionId("native-memory-fresh-artifact") },
				);
				yield* track(neighbour);
				expect(yield* service.run(neighbour)).toMatchObject({ success: true, value: "fresh" });
				yield* assertDisposed(neighbour.executionId);
			}),
		),
	);

	test.effect("replay_exit_paths_dispose_isolates_and_retire_handles", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const service = yield* SandboxService;
				const evidence = yield* NativeMemoryEvidence;
				const track = yield* trackNativeKeys;
				const compiled = yield* compiler.compile(exitSource);
				const fresh = yield* compiler.compile(freshSource);
				const file = yield* compiler.compile(fileSource);
				for (const mode of [
					"success",
					"pending",
					"failure",
					"timeout",
					"cancel-host",
					"cancel-inline",
					"scratch-cancel",
				]) {
					const input = makeRunnerInput(
						mode.startsWith("scratch-") ? file : compiled,
						{ mode },
						{
							executionId: testExecutionId(`native-disposal-${mode}`),
							...(mode === "success" ||
							mode === "pending" ||
							mode === "failure" ||
							mode === "cancel-inline"
								? { replayJournal: [], workflowExecutionId: `native-disposal-parent-${mode}` }
								: {}),
						},
					);
					const started = yield* Deferred.make<void>();
					const interrupted = yield* Deferred.make<void>();
					evidence.blocked.set(mode, { started, interrupted });
					const target =
						mode === "cancel-inline"
							? {
									...input,
									inlineDurableHost: {
										capabilities: ["getCachedValue"] as const,
										settle: () =>
											Deferred.succeed(started, undefined).pipe(
												Effect.andThen(Effect.never),
												Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
											),
									},
								}
							: input;
					yield* track(target);
					if (mode === "cancel-host" || mode === "cancel-inline" || mode === "scratch-cancel") {
						const fiber = yield* Effect.forkChild(service.run(target));
						if (mode === "scratch-cancel") {
							yield* nextCall(input.executionId, "scratchWrite", 256 * 1024);
						} else {
							yield* Deferred.await(started);
						}
						yield* Fiber.interrupt(fiber);
						const exit = yield* Fiber.await(fiber);
						assert(Exit.isFailure(exit));
						expect(Cause.hasInterrupts(exit.cause)).toBe(true);
						if (mode !== "scratch-cancel") {
							yield* Deferred.await(interrupted);
						}
					} else if (mode === "timeout") {
						const exit = yield* Effect.exit(service.run(target));
						assert(Exit.isFailure(exit));
						const error = Cause.findErrorOption(exit.cause);
						assert(Option.isSome(error));
						expect(error.value).toBeInstanceOf(TimeoutError);
					} else {
						const result = yield* service.run(target);
						if (mode === "success") {
							expect(result).toMatchObject({
								success: true,
								value: { requests: [], journalLength: 0, state: "completed", output: "finished" },
							});
						}
						if (mode === "pending") {
							expect(result).toMatchObject({
								success: true,
								value: {
									state: "pending",
									journalLength: 0,
									requests: [
										{
											index: 0,
											kind: "host",
											name: "getCachedValue",
											args: { args: ["pending"], capability: "getCachedValue" },
										},
									],
								},
							});
						}
						if (mode === "failure") {
							expect(result).toMatchObject({
								success: true,
								value: {
									requests: [],
									state: "failed",
									journalLength: 0,
									error: "expected disposal failure",
								},
							});
						}
					}
					yield* assertDisposed(input.executionId);
					const neighbour = makeRunnerInput(
						fresh,
						{ mode: "fresh" },
						{ executionId: testExecutionId(`native-disposal-fresh-${mode}`) },
					);
					yield* track(neighbour);
					expect(yield* service.run(neighbour)).toMatchObject({ success: true, value: "fresh" });
					yield* assertDisposed(neighbour.executionId);
				}
			}),
		),
	);

	test.effect("native_scratch_write_failure_is_returned_after_partial_upload_cleanup", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const compiler = yield* SandboxCompiler;
				const service = yield* SandboxService;
				const evidence = yield* NativeMemoryEvidence;
				const track = yield* trackNativeKeys;
				const compiled = yield* compiler.compile(fileSource);
				const input = makeRunnerInput(
					compiled,
					{ mode: "scratch-overflow" },
					{ executionId: testExecutionId("native-memory-scratch-failure") },
				);
				yield* track(input);
				const result = yield* service.run(input);
				const handle = evidence.runs.get(input.executionId)?.handle;
				expect(evidence.failures.filter((failure) => failure.handle === handle)).toEqual([
					{ handle, error: "Sandbox scratch write exceeds its 5 MiB quota" },
				]);
				yield* assertDisposed(input.executionId);
				const fresh = yield* compiler.compile(freshSource);
				const neighbour = makeRunnerInput(
					fresh,
					{ mode: "fresh" },
					{ executionId: testExecutionId("native-memory-fresh-scratch-failure") },
				);
				yield* track(neighbour);
				expect(yield* service.run(neighbour)).toMatchObject({ success: true, value: "fresh" });
				yield* assertDisposed(neighbour.executionId);
				expect(result).toMatchObject({
					success: false,
					error: { message: expect.stringContaining("quota") },
				});
			}),
		),
	);
});
