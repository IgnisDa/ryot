import { BunServices } from "@effect/platform-bun";
import {
	ClientPluginCompilerFailure,
	clientPluginCompilationFailure,
	clientPluginCompilerDiagnostic,
} from "@ryot/client-plugin-compiler/diagnostics";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "@ryot/client-plugin-compiler/limits";
import {
	ClientCompilerWorkerResponse,
	type ClientPluginCompilerRequest,
} from "@ryot/client-plugin-compiler/protocol";
import {
	Context,
	Duration,
	Effect,
	Fiber,
	FileSystem,
	Layer,
	Path,
	Ref,
	Result,
	Schema,
	Semaphore,
	Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { processTreeMemoryBytes } from "./process-memory";

const processFailure = (code: string, message: string) =>
	clientPluginCompilationFailure([clientPluginCompilerDiagnostic(code, "client", message)]);

const decodeClientCompilerWorkerResponse = Schema.decodeUnknownEffect(
	Schema.fromJsonString(ClientCompilerWorkerResponse),
);

export class ClientPluginCompiler extends Context.Service<ClientPluginCompiler>()(
	"ClientPluginCompiler",
	{
		make: Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const semaphore = yield* Semaphore.make(CLIENT_PLUGIN_COMPILER_LIMITS.concurrency);
			const current = new URL(import.meta.url);
			const currentPath = yield* path.fromFileUrl(current).pipe(Effect.orDie);
			const compilerWorkerPath = currentPath.endsWith(".ts")
				? Bun.resolveSync("@ryot/client-plugin-compiler/worker", currentPath)
				: yield* path
						.fromFileUrl(new URL("./client-plugin-compiler-worker.js", current))
						.pipe(Effect.orDie);

			const runWorker = (request: string) =>
				Effect.scoped(
					Effect.gen(function* () {
						const command = ChildProcess.make(
							process.execPath,
							["--smol", "--no-orphans", "--no-install", "--no-env-file", compilerWorkerPath],
							{
								stdout: "pipe",
								stderr: "pipe",
								stdin: Stream.succeed(new TextEncoder().encode(request)),
							},
						);
						const worker = yield* spawner.spawn(command);
						yield* Effect.addFinalizer(() =>
							worker.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore),
						);

						const stdout = yield* worker.stdout.pipe(
							Stream.decodeText({ encoding: "utf-8" }),
							Stream.runFold(
								() => "",
								(output, chunk) => output + chunk,
							),
							Effect.forkScoped,
						);
						const stderr = yield* worker.stderr.pipe(Stream.runDrain, Effect.forkScoped);
						const memoryExceeded = yield* Ref.make(false);
						const memorySupervisionFailed = yield* Ref.make(false);
						if (process.platform === "linux") {
							yield* Effect.gen(function* () {
								const pid = Number(worker.pid);
								const rootMemory = yield* Effect.result(
									fs.readFileString(`/proc/${pid}/smaps_rollup`),
								);
								if (Result.isFailure(rootMemory)) {
									const running = yield* worker.isRunning.pipe(Effect.orElseSucceed(() => false));
									if (running) {
										yield* Ref.set(memorySupervisionFailed, true);
										yield* worker.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore);
									}
									yield* Effect.sleep(
										Duration.millis(CLIENT_PLUGIN_COMPILER_LIMITS.memoryPollIntervalMs),
									);
									return;
								}
								const memoryBytes = yield* processTreeMemoryBytes(
									fs,
									pid,
									new Set(),
									rootMemory.success,
								);
								if (memoryBytes > CLIENT_PLUGIN_COMPILER_LIMITS.memoryBytes) {
									yield* Ref.set(memoryExceeded, true);
									yield* worker.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore);
								}
								yield* Effect.sleep(
									Duration.millis(CLIENT_PLUGIN_COMPILER_LIMITS.memoryPollIntervalMs),
								);
							}).pipe(Effect.forever, Effect.forkScoped);
						}

						const exitCode = yield* Effect.result(worker.exitCode);
						if (yield* Ref.get(memoryExceeded)) {
							return yield* processFailure(
								"RYOT_CLIENT_COMPILER_MEMORY",
								`Client plugin compiler exceeded ${CLIENT_PLUGIN_COMPILER_LIMITS.memoryBytes} bytes of proportional memory`,
							);
						}
						if (yield* Ref.get(memorySupervisionFailed)) {
							return yield* processFailure(
								"RYOT_CLIENT_COMPILER_MEMORY",
								"Client plugin compiler memory supervision became unavailable",
							);
						}
						if (Result.isFailure(exitCode) || Number(exitCode.success) !== 0) {
							return yield* processFailure(
								"RYOT_CLIENT_COMPILER_PROCESS",
								"Client plugin compiler process exited before returning a result",
							);
						}
						const output = yield* Fiber.join(stdout);
						yield* Fiber.join(stderr);
						return output;
					}),
				).pipe(
					Effect.mapError((error) =>
						error instanceof ClientPluginCompilerFailure
							? error
							: processFailure(
									"RYOT_CLIENT_COMPILER_PROCESS",
									"Client plugin compiler process could not be started or read",
								),
					),
				);

			const compile = (request: ClientPluginCompilerRequest) =>
				semaphore.withPermits(1)(
					runWorker(JSON.stringify(request)).pipe(
						Effect.timeoutOrElse({
							duration: Duration.millis(CLIENT_PLUGIN_COMPILER_LIMITS.timeoutMs),
							orElse: () =>
								Effect.fail(
									processFailure(
										"RYOT_CLIENT_COMPILER_TIMEOUT",
										`Client plugin compilation timed out after ${CLIENT_PLUGIN_COMPILER_LIMITS.timeoutMs}ms`,
									),
								),
						}),
						Effect.flatMap((output) =>
							decodeClientCompilerWorkerResponse(output).pipe(
								Effect.mapError(() =>
									processFailure(
										"RYOT_CLIENT_COMPILER_PROCESS",
										"Client plugin compiler process returned an invalid result",
									),
								),
							),
						),
						Effect.flatMap((response) =>
							response.success
								? Effect.succeed(response.value.artifact)
								: Effect.fail(
										new ClientPluginCompilerFailure({
											message: response.error.message,
											diagnostics: response.error.diagnostics,
										}),
									),
						),
					),
				);

			return { compile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(BunServices.layer));
}
