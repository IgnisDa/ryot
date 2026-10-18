import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import { Context, Deferred, Effect, FileSystem, Layer, Option, Queue } from "effect";

import {
	base64DecodedLength,
	type SidecarDoneFrame,
	type SidecarHostCallFrame,
	type SidecarRunFrame,
} from "../protocol/messages";
import { SandboxSidecarAdmission } from "./admission";
import { SandboxExecutionAuthority } from "./authority";
import { SandboxExecutor } from "./executor";
import { ExecutionFiles } from "./file-access";
import { decodedHostCallArgs } from "./host-call-args.test-support";
import { SandboxHostCallGate, type SandboxHostCallGateRegistration } from "./host-call-gate";
import { SandboxHostFunctions } from "./host-functions";
import {
	makeSandboxHostConfigLayer,
	testSandboxRedisLayer,
	unusedSandboxHostFunctions,
} from "./host.test-support";
import { SandboxSidecarQuarantine } from "./quarantine";
import { SandboxRecoveryStore } from "./recovery-store";
import {
	nativePlatformLayer,
	recordingSidecarClient,
	type SidecarRecorder,
} from "./runner-native.test-support";
import { SandboxSidecarSupervisor } from "./supervisor";

const shortDeadlineMs = 2_000;

type RunFrame = typeof SidecarRunFrame.Type;
type CallFrame = typeof SidecarHostCallFrame.Type;

export class NativeMemoryEvidence extends Context.Service<NativeMemoryEvidence>()(
	"test/NativeMemoryEvidence",
	{
		make: Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-native-memory-" });
			const calls: Array<{ readonly args: unknown } & Pick<CallFrame, "name" | "handle">> = [];
			const ranges: Array<{
				readonly bytes: number;
				readonly handle: string;
				readonly offset: number;
			}> = [];
			const failures: Array<{ readonly error: string; readonly handle: string }> = [];
			const reservations: Array<ReturnType<SandboxSidecarAdmission["Service"]["snapshot"]>> = [];
			return {
				calls,
				ranges,
				failures,
				reservations,
				retired: new Set<string>(),
				root: yield* fs.realPath(root),
				activeHosts: new Set<string>(),
				activeFiles: new Set<string>(),
				shortDeadline: new Set<string>(),
				registrations: new Map<string, SandboxHostCallGateRegistration>(),
				done: new Map<string, (typeof SidecarDoneFrame.Type)["outcome"]>(),
				events: yield* Queue.unbounded<{ readonly name: string; readonly handle: string }>(),
				files: new Map<string, Effect.Success<ReturnType<ExecutionFiles["Service"]["open"]>>>(),
				blocked: new Map<
					string,
					{
						readonly started: Deferred.Deferred<void>;
						readonly interrupted: Deferred.Deferred<void>;
					}
				>(),
				runs: new Map<
					string,
					{
						readonly handle: string;
						readonly generation: number;
						readonly limits: RunFrame["limits"];
					}
				>(),
			};
		}),
	},
) {}

const hosts = Layer.effect(
	SandboxHostFunctions,
	Effect.gen(function* () {
		const evidence = yield* NativeMemoryEvidence;
		return unusedSandboxHostFunctions({
			getCachedValue: (input, key) =>
				Effect.gen(function* () {
					const block = evidence.blocked.get(key);
					if (block === undefined) {
						return "native-host";
					}
					evidence.activeHosts.add(input.executionId);
					return yield* Deferred.succeed(block.started, undefined).pipe(
						Effect.andThen(Effect.never),
						Effect.onInterrupt(() => Deferred.succeed(block.interrupted, undefined)),
						Effect.ensuring(Effect.sync(() => evidence.activeHosts.delete(input.executionId))),
					);
				}),
		});
	}),
);

const recordingClient = recordingSidecarClient(
	Effect.gen(function* () {
		const evidence = yield* NativeMemoryEvidence;
		const admission = yield* SandboxSidecarAdmission;
		return {
			retired: (handle: string) => {
				evidence.retired.add(handle);
			},
			received: (frame) => {
				if (frame.type === "hostCall") {
					const decoded = decodedHostCallArgs(frame.args);
					const args =
						frame.name === "scratchWrite" && isObjectRecord(decoded)
							? { final: decoded["final"] ?? null, offset: decoded["offset"] ?? null }
							: decoded;
					evidence.calls.push({ args, name: frame.name, handle: frame.handle });
					evidence.reservations.push(admission.snapshot());
					Queue.offerUnsafe(evidence.events, { name: frame.name, handle: frame.handle });
				}
				if (frame.type === "done") {
					evidence.done.set(frame.handle, frame.outcome);
				}
			},
			sent: (frame) => {
				if (frame.type === "run" && isObjectRecord(frame.input)) {
					const executionId = frame.input["executionId"];
					if (typeof executionId === "string") {
						evidence.runs.set(executionId, {
							handle: frame.handle,
							limits: frame.limits,
							generation: frame.generation,
						});
						if (evidence.shortDeadline.has(executionId)) {
							return { ...frame, limits: { ...frame.limits, deadlineMs: shortDeadlineMs } };
						}
					}
				}
				if (frame.type === "hostResult" && frame.result.status === "success") {
					const value = frame.result.value;
					if (isObjectRecord(value)) {
						if (value["success"] === false && typeof value["error"] === "string") {
							evidence.failures.push({ handle: frame.handle, error: value["error"] });
						}
						const data = value["data"];
						const offset = value["offset"];
						if (typeof data === "string" && typeof offset === "number") {
							evidence.ranges.push({
								offset,
								handle: frame.handle,
								bytes: base64DecodedLength(data),
							});
						}
					}
				}
				return frame;
			},
		} satisfies SidecarRecorder;
	}),
);

const recordingGate = Layer.effect(
	SandboxHostCallGate,
	Effect.gen(function* () {
		const real = yield* SandboxHostCallGate;
		const evidence = yield* NativeMemoryEvidence;
		return {
			transientMemory: real.transientMemory,
			register: Effect.fnUntraced(function* (options: Parameters<typeof real.register>[0]) {
				const registration = yield* real.register(options);
				evidence.registrations.set(options.handle, registration);
				return registration;
			}),
		};
	}),
).pipe(Layer.provide(SandboxHostCallGate.layer));

const recordingFiles = Layer.effect(
	ExecutionFiles,
	Effect.gen(function* () {
		const real = yield* ExecutionFiles;
		const evidence = yield* NativeMemoryEvidence;
		return {
			open: Effect.fnUntraced(function* (input: Parameters<typeof real.open>[0]) {
				const files = yield* real.open(input);
				evidence.files.set(input.executionId, files);
				evidence.activeFiles.add(input.executionId);
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => evidence.activeFiles.delete(input.executionId)),
				);
				return files;
			}),
		};
	}),
).pipe(Layer.provide(ExecutionFiles.layer));

export const nativeMemoryLayer = Layer.unwrap(
	Effect.gen(function* () {
		const evidence = yield* NativeMemoryEvidence;
		const config = makeSandboxHostConfigLayer({
			tempDirectory: evidence.root,
			runId: "native-memory-disposal",
			memoryBudgetMiB: Option.some(1536),
		});
		const dependencies = Layer.mergeAll(
			recordingClient,
			recordingGate,
			recordingFiles,
			hosts,
			ViteBuildService.layer,
			SandboxRecoveryStore.layer,
			SandboxSidecarQuarantine.layer,
			Layer.succeed(SandboxExecutionAuthority, { resolve: () => Effect.succeed("user") }),
		).pipe(
			Layer.provideMerge(SandboxSidecarAdmission.layer),
			Layer.provideMerge(testSandboxRedisLayer),
			Layer.provideMerge(config),
		);
		return Layer.effect(SandboxExecutor, SandboxExecutor.make).pipe(
			Layer.provideMerge(Layer.effect(SandboxSidecarSupervisor, SandboxSidecarSupervisor.make)),
			Layer.provideMerge(dependencies),
		);
	}),
).pipe(
	Layer.provideMerge(Layer.effect(NativeMemoryEvidence, NativeMemoryEvidence.make)),
	Layer.provideMerge(nativePlatformLayer),
);
