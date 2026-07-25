import { BunServices } from "@effect/platform-bun";
import { SandboxCompilationFailure } from "@ryot/contract/modules/sandbox/schemas";
import { CompilerWorkerResponse } from "@ryot/sandbox-compiler/protocol";
import { sandboxManifestSchema } from "@ryot/sandbox-sdk/core";
import {
	Context,
	Duration,
	Effect,
	Result,
	Fiber,
	Layer,
	Ref,
	Schema,
	Stream,
	FileSystem,
	Path,
	Semaphore,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { SANDBOX_LIMITS, utf8ByteLength } from "#lib/infrastructure/sandbox-runtime/limits";

const processFailure = (code: string, message: string) =>
	new SandboxCompilationFailure({
		message: "Sandbox TypeScript compilation failed",
		diagnostics: [{ code, message, line: 1, column: 1, severity: "error", file: "script.ts" }],
	});
const decodeCompilerWorkerResponse = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CompilerWorkerResponse),
);

const readProportionalBytes = (memory: string) => {
	const match = /^Pss:\s+(\d+)\s+kB$/m.exec(memory);
	return match?.[1] ? Number(match[1]) * 2 ** 10 : 0;
};

export class SandboxCompiler extends Context.Service<SandboxCompiler>()("SandboxCompiler", {
	make: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const semaphore = yield* Semaphore.make(SANDBOX_LIMITS.compiler.concurrency);
		const current = new URL(import.meta.url);
		const currentPath = yield* path.fromFileUrl(current).pipe(Effect.orDie);
		const compilerWorkerPath = currentPath.endsWith(".ts")
			? Bun.resolveSync("@ryot/sandbox-compiler/worker", currentPath)
			: yield* path.fromFileUrl(new URL("./compiler-worker.js", current)).pipe(Effect.orDie);

		const processTreeMemoryBytes = (
			pid: number,
			visited: Set<number>,
			knownMemory?: string,
		): Effect.Effect<number> =>
			Effect.gen(function* () {
				if (visited.has(pid)) {
					return 0;
				}
				visited.add(pid);

				const memory =
					knownMemory ??
					(yield* fs
						.readFileString(`/proc/${pid}/smaps_rollup`)
						.pipe(Effect.orElseSucceed(() => "")));
				const children = yield* fs
					.readFileString(`/proc/${pid}/task/${pid}/children`)
					.pipe(Effect.orElseSucceed(() => ""));
				const childPids = children
					.trim()
					.split(/\s+/)
					.map(Number)
					.filter((childPid) => Number.isSafeInteger(childPid) && childPid > 0);
				const childBytes = yield* Effect.forEach(
					childPids,
					(childPid) => processTreeMemoryBytes(childPid, visited),
					{ concurrency: "unbounded" },
				);
				return (
					readProportionalBytes(memory) + childBytes.reduce((total, bytes) => total + bytes, 0)
				);
			});

		const runWorker = (source: string) =>
			Effect.scoped(
				Effect.gen(function* () {
					const command = ChildProcess.make(
						process.execPath,
						["--smol", "--no-orphans", "--no-install", "--no-env-file", compilerWorkerPath],
						{
							stdin: Stream.succeed(new TextEncoder().encode(source)),
							stdout: "pipe",
							stderr: "pipe",
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
								yield* Effect.sleep(Duration.millis(SANDBOX_LIMITS.compiler.memoryPollIntervalMs));
								return;
							}
							const memoryBytes = yield* processTreeMemoryBytes(pid, new Set(), rootMemory.success);
							if (memoryBytes > SANDBOX_LIMITS.compiler.memoryBytes) {
								yield* Ref.set(memoryExceeded, true);
								yield* worker.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore);
							}
							yield* Effect.sleep(Duration.millis(SANDBOX_LIMITS.compiler.memoryPollIntervalMs));
						}).pipe(Effect.forever, Effect.forkScoped);
					}

					const exitCode = yield* Effect.result(worker.exitCode);
					if (yield* Ref.get(memoryExceeded)) {
						return yield* processFailure(
							"RYOT_COMPILER_MEMORY",
							`Sandbox compiler exceeded ${SANDBOX_LIMITS.compiler.memoryBytes} bytes of proportional memory`,
						);
					}
					if (yield* Ref.get(memorySupervisionFailed)) {
						return yield* processFailure(
							"RYOT_COMPILER_MEMORY",
							"Sandbox compiler memory supervision became unavailable",
						);
					}
					if (Result.isFailure(exitCode) || Number(exitCode.success) !== 0) {
						return yield* processFailure(
							"RYOT_COMPILER_PROCESS",
							"Sandbox compiler process exited before returning a result",
						);
					}
					const output = yield* Fiber.join(stdout);
					yield* Fiber.join(stderr);
					return output;
				}),
			).pipe(
				Effect.mapError((error) =>
					error instanceof SandboxCompilationFailure
						? error
						: processFailure(
								"RYOT_COMPILER_PROCESS",
								"Sandbox compiler process could not be started or read",
							),
				),
			);

		const compile = (source: string) => {
			if (utf8ByteLength(source) > SANDBOX_LIMITS.compiler.sourceBytes) {
				return Effect.fail(
					processFailure(
						"RYOT_SOURCE_SIZE",
						`Sandbox TypeScript source exceeds ${SANDBOX_LIMITS.compiler.sourceBytes} UTF-8 bytes`,
					),
				);
			}

			return semaphore.withPermits(1)(
				runWorker(source).pipe(
					Effect.timeoutOrElse({
						duration: Duration.millis(SANDBOX_LIMITS.compiler.timeoutMs),
						orElse: () =>
							Effect.fail(
								processFailure(
									"RYOT_COMPILER_TIMEOUT",
									`Sandbox compilation timed out after ${SANDBOX_LIMITS.compiler.timeoutMs}ms`,
								),
							),
					}),
					Effect.flatMap((output) =>
						decodeCompilerWorkerResponse(output).pipe(
							Effect.mapError(() =>
								processFailure(
									"RYOT_COMPILER_PROCESS",
									"Sandbox compiler process returned an invalid result",
								),
							),
						),
					),
					Effect.flatMap((response) => {
						if (!response.success) {
							return Effect.fail(
								new SandboxCompilationFailure({
									message: response.error.message,
									diagnostics: response.error.diagnostics,
								}),
							);
						}

						return Schema.decodeUnknownEffect(sandboxManifestSchema)(response.value.manifest).pipe(
							Effect.mapError(() =>
								processFailure(
									"RYOT_COMPILER_PROCESS",
									"Sandbox compiler process returned an invalid manifest",
								),
							),
							Effect.map((manifest) => ({
								manifest,
								format: response.value.format,
								javascript: response.value.javascript,
							})),
						);
					}),
				),
			);
		};

		return { compile };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(BunServices.layer));
}
