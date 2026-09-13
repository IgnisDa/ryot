import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Context, Deferred, Effect, FileSystem, Layer, Option, Queue, Redacted } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import { SandboxRecoveryStore } from "#lib/infrastructure/sandbox-recovery-store";
import { ServerRun } from "#lib/infrastructure/server-run";
import { testRedisUrl } from "#lib/test-utils/redis";
import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

import { SandboxExecutionAuthority } from "./execution-principal";
import { SandboxFileService } from "./file-service";
import { decodedHostCallArgs } from "./host-call-args.test-support";
import { SandboxHostCallGate, type SandboxHostCallGateRegistration } from "./host-call-gate";
import { SandboxHostImplementations } from "./host-implementations";
import {
	nativeConfigLayer,
	nativePlatformLayer,
	recordingSidecarClient,
	unusedSandboxHostImplementations,
	type SidecarRecorder,
} from "./runner-native.test-support";
import { SandboxService } from "./service";
import { SandboxSidecarAdmission } from "./sidecar-admission";
import {
	base64DecodedLength,
	type SidecarDoneFrame,
	type SidecarHostCallFrame,
	type SidecarRunFrame,
} from "./sidecar-protocol";
import { SandboxSidecarQuarantine } from "./sidecar-quarantine";
import { SandboxSidecarSupervisor } from "./sidecar-supervisor";

type RunFrame = typeof SidecarRunFrame.Type;
type CallFrame = typeof SidecarHostCallFrame.Type;

export class NativeMemoryEvidence extends Context.Service<NativeMemoryEvidence>()(
	"test/NativeMemoryEvidence",
	{
		make: Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-native-memory-" });
			const calls: Array<Pick<CallFrame, "handle" | "name"> & { readonly args: unknown }> = [];
			const ranges: Array<{
				readonly handle: string;
				readonly offset: number;
				readonly bytes: number;
			}> = [];
			const failures: Array<{ readonly handle: string; readonly error: string }> = [];
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
				registrations: new Map<string, SandboxHostCallGateRegistration>(),
				done: new Map<string, (typeof SidecarDoneFrame.Type)["outcome"]>(),
				events: yield* Queue.unbounded<{ readonly handle: string; readonly name: string }>(),
				files: new Map<string, Effect.Success<ReturnType<SandboxFileService["Service"]["open"]>>>(),
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
	SandboxHostImplementations,
	Effect.gen(function* () {
		const evidence = yield* NativeMemoryEvidence;
		return unusedSandboxHostImplementations({
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
			register: Effect.fnUntraced(function* (options: Parameters<typeof real.register>[0]) {
				const registration = yield* real.register(options);
				evidence.registrations.set(options.handle, registration);
				return registration;
			}),
		};
	}),
).pipe(Layer.provide(SandboxHostCallGate.layer));

const recordingFiles = Layer.effect(
	SandboxFileService,
	Effect.gen(function* () {
		const real = yield* SandboxFileService;
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
).pipe(Layer.provide(SandboxFileService.layer));

export const nativeMemoryLayer = Layer.unwrap(
	Effect.gen(function* () {
		const evidence = yield* NativeMemoryEvidence;
		const config = nativeConfigLayer({
			redisUrl: Redacted.make(testRedisUrl()),
			fileStorage: { localTempDir: evidence.root },
			sandbox: { memoryBudgetMiB: Option.some(2048) },
		});
		const dependencies = Layer.mergeAll(
			recordingClient,
			recordingGate,
			recordingFiles,
			hosts,
			SandboxCompiler.layer,
			SandboxRecoveryStore.layer,
			SandboxSidecarQuarantine.layer,
			Layer.succeed(SandboxExecutionAuthority, { resolve: () => Effect.succeed("user") }),
		).pipe(
			Layer.provideMerge(Layer.succeed(ServerRun, { id: "native-memory-disposal" })),
			Layer.provideMerge(SandboxSidecarAdmission.layer),
			Layer.provideMerge(RedisService.layer),
			Layer.provideMerge(config),
		);
		return Layer.effect(SandboxService, SandboxService.make).pipe(
			Layer.provideMerge(Layer.effect(SandboxSidecarSupervisor, SandboxSidecarSupervisor.make)),
			Layer.provideMerge(dependencies),
		);
	}),
).pipe(
	Layer.provideMerge(Layer.effect(NativeMemoryEvidence, NativeMemoryEvidence.make)),
	Layer.provideMerge(nativePlatformLayer),
);
