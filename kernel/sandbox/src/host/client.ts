import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { Context, Deferred, Effect, FileSystem, Layer, Path, Queue, Schema } from "effect";

import { makeSidecarFrameReader, makeSidecarFrameWriter } from "../protocol/framing";
import { SANDBOX_LIMITS } from "../protocol/limits";
import {
	SIDECAR_GENERATION_MAX,
	type SidecarInboundLogicalMessage,
	SidecarOutboundFrame,
	SidecarTier,
} from "../protocol/messages";
import { SandboxTrust } from "./authority";
import {
	recordSandboxAggregateRss,
	recordSandboxRuntimeGauges,
	recordSandboxSidecarEvent,
	recordSandboxSidecarProcesses,
} from "./metrics";
import { parseProcStatusRssBytes } from "./process-sampling";

export const SANDBOX_LAUNCHER_PATH = "/usr/local/libexec/ryot-sandbox-launcher";

const installationSchema = Schema.Union([
	Schema.Struct({ launcher: Schema.String }),
	Schema.Struct({ snapshots: Schema.String, executable: Schema.String }),
]);

class SandboxSidecarInstallation extends Context.Service<
	SandboxSidecarInstallation,
	typeof installationSchema.Type
>()("@ryot-app/sandbox/host/client/SandboxSidecarInstallation") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const path = yield* Path.Path;
			if (process.platform === "linux") {
				return { launcher: SANDBOX_LAUNCHER_PATH };
			}
			const source = yield* path.fromFileUrl(new URL(import.meta.url));
			const directory = path.resolve(path.dirname(source), "../../dist");
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
	trust: SandboxTrust,
	maxActive: Schema.Int,
	generation: Schema.Int,
	memoryBudget: Schema.Int,
});

class SidecarClientError extends Schema.TaggedError<
	SidecarClientError,
	{ readonly brand: unique symbol }
>()("SidecarClientError", {
	message: Schema.String,
	reason: Schema.Literals(["exit", "startup", "disposal", "transport"]),
}) {}

const processExit = Effect.fnUntraced(function* (child: Bun.Subprocess) {
	return yield* Effect.tryPromise({
		try: () => child.exited,
		catch: () =>
			new SidecarClientError({ reason: "exit", message: "Could not confirm process exit" }),
	});
});

const runProcess = Effect.fnUntraced(function* (command: ReadonlyArray<string>) {
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const child = yield* Effect.acquireRelease(
				Effect.try({
					catch: () =>
						new SidecarClientError({ reason: "startup", message: "Could not spawn process" }),
					try: () =>
						Bun.spawn([...command], { env: {}, stdout: "pipe", stdin: "ignore", stderr: "ignore" }),
				}),
				(subprocess) =>
					Effect.gen(function* () {
						if (subprocess.exitCode === null && subprocess.signalCode === null) {
							subprocess.kill("SIGKILL");
						}
						yield* processExit(subprocess).pipe(Effect.orDie);
					}),
			);
			const [code, stdout] = yield* Effect.all([
				processExit(child),
				Effect.tryPromise({
					try: () => new Response(child.stdout).text(),
					catch: () =>
						new SidecarClientError({
							reason: "transport",
							message: "Could not read process output",
						}),
				}),
			]);
			return { code, stdout };
		}),
	);
});

const queueFailure = () =>
	new SidecarClientError({ reason: "transport", message: "Could not queue sidecar frame" });
const sidecarClientEvent = Schema.Union([
	SidecarOutboundFrame,
	Schema.Struct({ handle: Schema.String, message: Schema.String, type: Schema.Literal("invalid") }),
]);
export class SandboxSidecarClient extends Context.Service<SandboxSidecarClient>()(
	"@ryot-app/sandbox/host/client/SandboxSidecarClient",
	{
		make: Effect.gen(function* () {
			const installation = yield* SandboxSidecarInstallation;
			const fs = yield* FileSystem.FileSystem;
			const rss = new Map<
				number,
				{ bytes: null | number; readonly tier: string; readonly trust: typeof SandboxTrust.Type }
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
					settings.generation > SIDECAR_GENERATION_MAX ||
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
				const failed = yield* Deferred.make<never, SidecarClientError>();
				const handles = new Map<string, ExecutionLane>();
				let closed = false;
				let socket: undefined | Bun.Socket;
				const fail = (message: string) => {
					Deferred.doneUnsafe(
						failed,
						Effect.fail(new SidecarClientError({ message, reason: "transport" })),
					);
				};
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
					maximumQueuedBytes: settings.threads * SANDBOX_LIMITS.sidecar.queuedBytesPerThread,
					write: (bytes) => {
						if (socket === undefined) {
							throw queueFailure();
						}
						const written = socket.write(bytes);
						return { written, blocked: written < bytes.byteLength };
					},
				});
				const guard = (operation: () => void) => {
					try {
						operation();
					} catch {
						fail("Sidecar protocol connection failed");
					}
				};
				const retireRss = (pid: number) =>
					Effect.suspend(() =>
						rss.delete(pid)
							? publishProcesses(settings).pipe(
									Effect.andThen(
										recordSandboxSidecarEvent({ ...settings, event: "stop", reason: "confirmed" }),
									),
									Effect.andThen(publishRss),
								)
							: Effect.void,
					);
				const dispose = Effect.fnUntraced(
					function* (child: Bun.Subprocess) {
						closed = true;
						writer.close();
						reader.close();
						handles.clear();
						socket?.shutdown();
						const stopped = yield* processExit(child).pipe(
							Effect.as(true),
							Effect.timeoutOrElse({
								orElse: () => Effect.succeed(false),
								duration: SANDBOX_LIMITS.sidecar.disposalMs,
							}),
						);
						if (!stopped) {
							if (linux) {
								const killer = yield* runProcess([
									command.executable,
									"terminate",
									String(child.pid),
								]).pipe(
									Effect.mapError(
										() =>
											new SidecarClientError({
												reason: "disposal",
												message: "Could not launch sidecar termination",
											}),
									),
								);
								if (killer.code !== 0) {
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
						yield* processExit(child).pipe(
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
						yield* retireRss(child.pid);
						return undefined;
					},
					Effect.ensuring(Effect.sync(() => socket?.terminate())),
				);
				const child = yield* Effect.acquireRelease(
					Effect.try({
						catch: () =>
							new SidecarClientError({ reason: "startup", message: "Could not spawn sidecar" }),
						try: () =>
							Bun.spawn([command.executable, ...command.prefix, ...args, ...command.suffix], {
								env: {},
								stdio: ["ignore", "ignore", "inherit", "pipe"],
							}),
					}),
					(subprocess) => Effect.scoped(dispose(subprocess)).pipe(Effect.orDie),
				);
				const pid = child.pid;
				const exit = Effect.gen(function* () {
					const code = yield* processExit(child);
					if (child.signalCode !== null) {
						return yield* new SidecarClientError({
							reason: "exit",
							message: `Sidecar exited with signal ${child.signalCode}`,
						});
					}
					return code;
				});
				rss.set(pid, { bytes: null, tier: settings.tier, trust: settings.trust });
				yield* recordSandboxSidecarEvent({ ...settings, event: "start", reason: "spawned" });
				yield* publishProcesses(settings);
				yield* Effect.uninterruptible(
					Effect.tryPromise({
						catch: () =>
							new SidecarClientError({
								reason: "startup",
								message: "Could not adopt sidecar socket",
							}),
						try: () => {
							const fd = child.stdio[3];
							if (fd === undefined || fd === null) {
								throw new SidecarClientError({
									reason: "startup",
									message: "Sidecar socket was not created",
								});
							}
							return Bun.connect({
								fd,
								allowHalfOpen: true,
								socket: {
									open: (connection) => {
										socket = connection;
									},
									drain: () => {
										if (!closed) {
											guard(() => writer.flush());
										}
									},
									end: () => {
										if (!closed) {
											fail("Sidecar socket closed");
										}
									},
									close: () => {
										if (!closed) {
											fail("Sidecar socket closed");
										}
									},
									error: () => {
										if (!closed) {
											fail("Sidecar socket failed");
										}
									},
									data: (_connection, bytes) => {
										if (!closed) {
											guard(() => reader.feed(bytes));
										}
									},
								},
							});
						},
					}),
				);
				const monitorIsActive = Effect.sync(
					() => !closed && child.exitCode === null && child.signalCode === null,
				);
				yield* Effect.gen(function* () {
					while (yield* monitorIsActive) {
						const bytes = yield* linux
							? fs.readFileString(`/proc/${pid}/status`).pipe(
									Effect.map(parseProcStatusRssBytes),
									Effect.orElseSucceed(() => null),
								)
							: runProcess(["ps", "-o", "rss=", "-p", String(pid)]).pipe(
									Effect.map(({ code, stdout }) => {
										const value = Number(stdout.trim());
										return code === 0 &&
											stdout.trim() !== "" &&
											Number.isFinite(value) &&
											value >= 0
											? value * 1024
											: null;
									}),
									Effect.orElseSucceed(() => null),
								);
						if (yield* monitorIsActive) {
							rss.set(pid, { bytes, tier: settings.tier, trust: settings.trust });
							yield* publishRss;
							yield* publishProcesses(settings);
						}
						yield* Effect.sleep("1 second");
					}
					yield* retireRss(pid);
				}).pipe(Effect.forkScoped);
				return {
					pid,
					exit,
					generation: settings.generation,
					close: Effect.scoped(dispose(child)),
					next: Effect.raceFirst(Queue.take(frames), Deferred.await(failed)),
					retire: (handle: string) =>
						Effect.sync(() => {
							handles.delete(handle);
							reader.retire(handle);
							writer.retire(handle);
						}),
					send: (frame: SidecarInboundLogicalMessage, released?: () => void) =>
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
