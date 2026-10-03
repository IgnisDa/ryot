// TODO: Use ChildProcessSpawner once it can pass one duplex socket (https://github.com/Effect-TS/effect/issues/8902).
// oxlint-disable-next-line effecttsgo/node-builtin-import
import { spawn } from "node:child_process";

import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { Context, Data, Deferred, Effect, FileSystem, Layer, Path, Queue, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { AppConfig } from "../config/service";
import {
	recordSandboxAggregateRss,
	recordSandboxRuntimeGauges,
	recordSandboxSidecarEvent,
	recordSandboxSidecarProcesses,
} from "../runtime-metrics";
import { SANDBOX_LIMITS } from "./limits";
import { parseProcStatusRssBytes } from "./process-sampling";
import { makeSidecarFrameReader, makeSidecarFrameWriter } from "./sidecar-framing";
import { SidecarTier, SidecarOutboundFrame, type SidecarInboundFrame } from "./sidecar-protocol";

export const SANDBOX_LAUNCHER_PATH = "/usr/local/libexec/ryot-sandbox-launcher";

const installationSchema = Schema.Union([
	Schema.Struct({ launcher: Schema.String }),
	Schema.Struct({ snapshots: Schema.String, executable: Schema.String }),
]);

export class SandboxSidecarInstallation extends Context.Service<
	SandboxSidecarInstallation,
	typeof installationSchema.Type
>()("SandboxSidecarInstallation") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const config = yield* AppConfig;
			const path = yield* Path.Path;
			if (process.platform === "linux") {
				return { launcher: SANDBOX_LAUNCHER_PATH };
			}
			const directory = path.resolve(config.sandbox.runtimeDirectory);
			return {
				snapshots: path.join(directory, "snapshots"),
				executable: path.join(directory, "ryot-sandboxd"),
			};
		}),
	);
}

const processSettingsSchema = Schema.Struct({
	tier: SidecarTier,
	maxRss: Schema.Int,
	threads: Schema.Int,
	maxActive: Schema.Int,
	generation: Schema.Int,
	memoryBudget: Schema.Int,
	trust: Schema.Literals(["system", "user"]),
});

export class SidecarClientError extends Data.TaggedError("SidecarClientError")<{
	readonly message: string;
	readonly reason: "startup" | "transport" | "exit" | "disposal";
}> {}

const exitSchema = Schema.Struct({
	code: Schema.NullOr(Schema.Int),
	signal: Schema.NullOr(Schema.String),
});

const diagnosticBytes = 64 * 1024;
const queueFailure = () =>
	new SidecarClientError({ reason: "transport", message: "Could not queue sidecar frame" });
const decoder = new TextDecoder();
const sidecarClientEvent = Schema.Union([
	SidecarOutboundFrame,
	Schema.Struct({ handle: Schema.String, message: Schema.String, type: Schema.Literal("invalid") }),
]);
const nativeEvents = Schema.declare<Pick<NodeJS.EventEmitter, "on" | "once">>(
	(value): value is Pick<NodeJS.EventEmitter, "on" | "once"> =>
		typeof value === "object" &&
		value !== null &&
		"on" in value &&
		typeof value.on === "function" &&
		"once" in value &&
		typeof value.once === "function",
);

export class SandboxSidecarClient extends Context.Service<SandboxSidecarClient>()(
	"SandboxSidecarClient",
	{
		make: Effect.gen(function* () {
			const installation = yield* SandboxSidecarInstallation;
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const fs = yield* FileSystem.FileSystem;
			const rss = new Map<
				number,
				{ readonly trust: "system" | "user"; readonly tier: string; bytes: number | null }
			>();
			const publishProcesses = (settings: typeof processSettingsSchema.Type) =>
				Effect.suspend(() => {
					const processes = [...rss.values()].filter(
						(entry) => entry.trust === settings.trust && entry.tier === settings.tier,
					);
					return recordSandboxSidecarProcesses({
						...settings,
						processes: processes.length,
						bytes: processes.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
					});
				});
			const publishRss = Effect.suspend(() =>
				Effect.all(
					[
						Effect.suspend(() => {
							const memory = process.memoryUsage();
							return recordSandboxRuntimeGauges({
								backendRssBytes: memory.rss,
								heapUsedBytes: memory.heapUsed,
								externalMemoryBytes: memory.external,
							});
						}),
						recordSandboxAggregateRss(
							[...rss.values()].reduce<number>((sum, entry) => sum + (entry.bytes ?? 0), 0),
							[...rss.values()].filter((entry) => entry.bytes !== null).length,
						),
					],
					{ discard: true },
				),
			);
			if (process.platform !== "linux") {
				yield* Effect.logWarning("Sandbox sidecars use unconfined development mode");
			}
			const connect = Effect.fn("SandboxSidecarClient.connect")(function* (
				settings: typeof processSettingsSchema.Type,
			) {
				const linux = process.platform === "linux";
				let command: {
					readonly executable: string;
					readonly prefix: ReadonlyArray<string>;
					readonly suffix: ReadonlyArray<string>;
				};
				if (linux && "launcher" in installation) {
					command = { suffix: [], prefix: ["launch"], executable: installation.launcher };
				} else if (!linux && "executable" in installation) {
					command = {
						prefix: [],
						executable: installation.executable,
						suffix: ["--snapshots", installation.snapshots],
					};
				} else {
					return yield* new SidecarClientError({
						reason: "startup",
						message: "Sandbox installation does not match the host platform",
					});
				}
				if (
					!Number.isSafeInteger(settings.generation) ||
					settings.generation < 0 ||
					settings.generation > 4_294_967_295 ||
					![settings.threads, settings.maxActive, settings.memoryBudget, settings.maxRss].every(
						(value) => Number.isSafeInteger(value) && value > 0,
					)
				) {
					return yield* new SidecarClientError({
						reason: "startup",
						message: "Invalid sidecar process settings",
					});
				}
				const args = [
					"--generation",
					String(settings.generation),
					"--tier",
					settings.tier,
					"--trust",
					settings.trust,
					"--threads",
					String(settings.threads),
					"--queue",
					String(settings.threads),
					"--max-active",
					String(settings.maxActive),
					"--memory-budget",
					String(settings.memoryBudget),
					"--max-rss",
					String(settings.maxRss),
				];
				const frames = yield* Queue.bounded<typeof sidecarClientEvent.Type>(
					settings.threads * 8 + 8,
				);
				const exited = yield* Deferred.make<typeof exitSchema.Type>();
				const failed = yield* Deferred.make<never, SidecarClientError>();
				const handles = new Map<string, ExecutionLane>();
				let closed = false;
				const monitorIsActive = Effect.gen(function* () {
					if (closed) {
						return false;
					}
					return !(yield* Deferred.isDone(exited));
				});
				let diagnostics = new Uint8Array();
				const child = yield* Effect.try({
					catch: () =>
						new SidecarClientError({ reason: "startup", message: "Could not spawn sidecar" }),
					try: () =>
						spawn(command.executable, [...command.prefix, ...args, ...command.suffix], {
							env: {},
							stdio: ["ignore", "ignore", "pipe", "pipe"],
						}),
				});
				const socket = child.stdio[3];
				const pid = child.pid;
				const retireRss = Effect.suspend(() =>
					pid !== undefined && rss.delete(pid)
						? publishProcesses(settings).pipe(
								Effect.andThen(
									recordSandboxSidecarEvent({ ...settings, event: "stop", reason: "confirmed" }),
								),
								Effect.andThen(publishRss),
							)
						: Effect.void,
				);
				if (pid !== undefined) {
					rss.set(pid, { bytes: null, tier: settings.tier, trust: settings.trust });
					yield* recordSandboxSidecarEvent({ ...settings, event: "start", reason: "spawned" });
					yield* publishProcesses(settings);
					yield* Effect.addFinalizer(() =>
						child.exitCode !== null || child.signalCode !== null ? retireRss : Effect.void,
					);
					yield* Effect.gen(function* () {
						while (yield* monitorIsActive) {
							const bytes = yield* (
								linux
									? fs
											.readFileString(`/proc/${pid}/status`)
											.pipe(Effect.map(parseProcStatusRssBytes))
									: spawner.string(ChildProcess.make("ps", ["-o", "rss=", "-p", String(pid)])).pipe(
											Effect.map((text) => {
												const value = Number(text.trim());
												return text.trim() !== "" && Number.isFinite(value) && value >= 0
													? value * 1024
													: null;
											}),
										)
							).pipe(Effect.orElseSucceed(() => null));
							if (yield* monitorIsActive) {
								rss.set(pid, { bytes, tier: settings.tier, trust: settings.trust });
								yield* publishRss;
								yield* publishProcesses(settings);
							}
							yield* Effect.sleep("1 second");
						}
						yield* retireRss;
					}).pipe(Effect.forkScoped);
				}
				const fail = (message: string) => {
					Deferred.doneUnsafe(
						failed,
						Effect.fail(new SidecarClientError({ message, reason: "transport" })),
					);
				};
				const events = yield* Schema.decodeUnknownEffect(nativeEvents)(child);
				events.once("exit", (code: number | null, signal: string | null) => {
					Deferred.doneUnsafe(exited, Effect.succeed({ code, signal }));
				});
				events.once("close", (code: number | null, signal: string | null) => {
					Deferred.doneUnsafe(exited, Effect.succeed({ code, signal }));
				});
				events.on("error", () => {
					if (!closed) {
						fail("Sidecar process failed");
					}
				});
				child.stderr?.on("data", (bytes: Uint8Array) => {
					const keep = Math.min(diagnosticBytes, bytes.byteLength);
					const previous = Math.min(diagnostics.byteLength, diagnosticBytes - keep);
					const next = new Uint8Array(previous + keep);
					next.set(diagnostics.subarray(diagnostics.byteLength - previous));
					next.set(bytes.subarray(bytes.byteLength - keep), previous);
					diagnostics = next;
				});
				const dispose = Effect.fnUntraced(function* () {
					closed = true;
					socket?.destroy();
					handles.clear();
					if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
						yield* retireRss;
						return undefined;
					}
					const stopped = yield* Deferred.await(exited).pipe(
						Effect.as(true),
						Effect.timeoutOrElse({
							orElse: () => Effect.succeed(false),
							duration: SANDBOX_LIMITS.sidecar.disposalMs,
						}),
					);
					if (!stopped) {
						if (linux) {
							const killer = yield* spawner
								.spawn(
									ChildProcess.make(command.executable, ["terminate", String(child.pid)], {
										env: {},
										stdin: "ignore",
										stdout: "ignore",
										stderr: "ignore",
									}),
								)
								.pipe(
									Effect.mapError(
										() =>
											new SidecarClientError({
												reason: "disposal",
												message: "Could not launch sidecar termination",
											}),
									),
								);
							const code = yield* killer.exitCode;
							if (Number(code) !== 0) {
								return yield* new SidecarClientError({
									reason: "disposal",
									message: "Privileged sidecar termination failed",
								});
							}
						} else {
							yield* Effect.try({
								try: () => child.kill("SIGKILL"),
								catch: () =>
									new SidecarClientError({
										reason: "disposal",
										message: "Could not terminate development sidecar",
									}),
							});
						}
					}
					yield* Deferred.await(exited).pipe(
						Effect.timeoutOrElse({
							duration: SANDBOX_LIMITS.sidecar.disposalMs,
							orElse: () =>
								Effect.fail(
									new SidecarClientError({
										reason: "disposal",
										message: "Sidecar exit was not confirmed after termination",
									}),
								),
						}),
					);
					yield* retireRss;
					return undefined;
				});
				yield* Effect.addFinalizer(() => Effect.scoped(dispose()).pipe(Effect.orDie));
				if (!socket || !("write" in socket) || !("read" in socket)) {
					return yield* new SidecarClientError({
						reason: "startup",
						message: "Sidecar descriptor 3 is not a duplex socket",
					});
				}
				const reader = makeSidecarFrameReader({
					generation: settings.generation,
					maximumAssemblies: settings.threads * 5,
					isActive: (handle) => handles.has(handle),
					maximumBufferedBytes: settings.threads * SANDBOX_LIMITS.sidecar.bufferedBytesPerThread,
					onFrame: (frame) => {
						if (!Queue.offerUnsafe(frames, frame)) {
							fail("Sidecar receive queue overflow");
						}
					},
					onInvalid: (handle, message) => {
						if (!Queue.offerUnsafe(frames, { handle, message, type: "invalid" })) {
							fail("Sidecar receive queue overflow");
						}
					},
				});
				const writer = makeSidecarFrameWriter({
					maximumRunMessages: settings.threads,
					lane: (handle) => handles.get(handle),
					maximumControlMessages: settings.threads * 5 + 1,
					write: (bytes) => ({ written: bytes.byteLength, blocked: !socket.write(bytes) }),
					maximumQueuedBytes: settings.threads * SANDBOX_LIMITS.sidecar.queuedBytesPerThread,
				});
				const guard = (operation: () => void) => {
					try {
						operation();
					} catch {
						fail("Sidecar protocol connection failed");
					}
				};
				socket.on("data", (bytes: Uint8Array) => guard(() => reader.feed(bytes)));
				socket.on("drain", () => guard(() => writer.flush()));
				socket.on("error", () => {
					if (!closed) {
						fail("Sidecar socket failed");
					}
				});
				socket.on("end", () => {
					if (!closed) {
						fail("Sidecar socket closed");
					}
				});
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						writer.close();
						reader.close();
					}),
				);
				return {
					pid: child.pid,
					exit: Deferred.await(exited),
					close: Effect.scoped(dispose()),
					generation: settings.generation,
					diagnostics: () => decoder.decode(diagnostics),
					next: Effect.raceFirst(Queue.take(frames), Deferred.await(failed)),
					retire: (handle: string) =>
						Effect.sync(() => {
							handles.delete(handle);
							reader.retire(handle);
							writer.retire(handle);
						}),
					send: (frame: SidecarInboundFrame, released?: () => void) =>
						Effect.suspend(() =>
							closed
								? Effect.fail(queueFailure())
								: Effect.try({
										catch: queueFailure,
										try: () => {
											writer.enqueue(frame, released);
											writer.flush();
										},
									}),
						),
					register: Effect.fnUntraced(function* (handle: string, lane: ExecutionLane) {
						if (closed || handles.has(handle) || handles.size >= settings.threads * 2) {
							return yield* new SidecarClientError({
								reason: "transport",
								message: "Sidecar handle registration rejected",
							});
						}
						handles.set(handle, lane);
						return undefined;
					}),
				};
			});
			return { connect };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(SandboxSidecarInstallation.layer),
	);
}
