import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { SandboxCompilationFailure } from "@ryot/contract/modules/sandbox/schemas";
import { sandboxManifestSchema } from "@ryot/sandbox-sdk";
import { Duration, Effect, Either, Fiber, Ref, Schema, Stream } from "effect";

import { SANDBOX_LIMITS, utf8ByteLength } from "#lib/infrastructure/sandbox-runtime/limits";

import { sandboxCompilationFailure, sandboxCompilerDiagnostic } from "./compiler-diagnostics";
import { type CompiledSandboxModule, CompilerWorkerResponse } from "./compiler-protocol";

export { type CompiledSandboxModule, SANDBOX_COMPILED_FORMAT } from "./compiler-protocol";

const processFailure = (code: string, message: string) =>
	sandboxCompilationFailure([sandboxCompilerDiagnostic(code, message)]);
const decodeCompilerWorkerResponse = Schema.decode(Schema.parseJson(CompilerWorkerResponse));

const readProportionalBytes = (memory: string) => {
	const match = /^Pss:\s+(\d+)\s+kB$/m.exec(memory);
	return match?.[1] ? Number(match[1]) * 2 ** 10 : 0;
};

const compilerWorkerPath = () => {
	const current = new URL(import.meta.url);
	const extension = current.pathname.endsWith(".ts") ? "ts" : "js";
	return Bun.fileURLToPath(new URL(`./compiler-worker.${extension}`, current));
};

export class SandboxCompiler extends Effect.Service<SandboxCompiler>()("SandboxCompiler", {
	dependencies: [BunContext.layer],
	effect: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const executor = yield* CommandExecutor.CommandExecutor;
		const semaphore = yield* Effect.makeSemaphore(SANDBOX_LIMITS.compiler.concurrency);

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
					const command = Command.make(
						process.execPath,
						"--smol",
						"--no-orphans",
						"--no-install",
						"--no-env-file",
						compilerWorkerPath(),
					).pipe(Command.feed(source), Command.stdout("pipe"), Command.stderr("pipe"));
					const worker = yield* executor.start(command);
					yield* Effect.addFinalizer(() => worker.kill("SIGKILL").pipe(Effect.ignore));

					const stdout = yield* worker.stdout.pipe(
						Stream.decodeText("utf-8"),
						Stream.runFold("", (output, chunk) => output + chunk),
						Effect.forkScoped,
					);
					const stderr = yield* worker.stderr.pipe(Stream.runDrain, Effect.forkScoped);
					const memoryExceeded = yield* Ref.make(false);
					const memorySupervisionFailed = yield* Ref.make(false);
					if (process.platform === "linux") {
						yield* Effect.gen(function* () {
							const pid = Number(worker.pid);
							const rootMemory = yield* Effect.either(
								fs.readFileString(`/proc/${pid}/smaps_rollup`),
							);
							if (Either.isLeft(rootMemory)) {
								const running = yield* worker.isRunning.pipe(Effect.orElseSucceed(() => false));
								if (running) {
									yield* Ref.set(memorySupervisionFailed, true);
									yield* worker.kill("SIGKILL").pipe(Effect.ignore);
								}
								yield* Effect.sleep(Duration.millis(SANDBOX_LIMITS.compiler.memoryPollIntervalMs));
								return;
							}
							const memoryBytes = yield* processTreeMemoryBytes(pid, new Set(), rootMemory.right);
							if (memoryBytes > SANDBOX_LIMITS.compiler.memoryBytes) {
								yield* Ref.set(memoryExceeded, true);
								yield* worker.kill("SIGKILL").pipe(Effect.ignore);
							}
							yield* Effect.sleep(Duration.millis(SANDBOX_LIMITS.compiler.memoryPollIntervalMs));
						}).pipe(Effect.forever, Effect.forkScoped);
					}

					const exitCode = yield* Effect.either(worker.exitCode);
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
					if (Either.isLeft(exitCode) || Number(exitCode.right) !== 0) {
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
					Effect.timeoutFail({
						duration: Duration.millis(SANDBOX_LIMITS.compiler.timeoutMs),
						onTimeout: () =>
							processFailure(
								"RYOT_COMPILER_TIMEOUT",
								`Sandbox compilation timed out after ${SANDBOX_LIMITS.compiler.timeoutMs}ms`,
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
							return Effect.fail(response.error);
						}

						const manifest = sandboxManifestSchema.safeParse(response.value.manifest);
						if (!manifest.success) {
							return Effect.fail(
								processFailure(
									"RYOT_COMPILER_PROCESS",
									"Sandbox compiler process returned an invalid manifest",
								),
							);
						}
						return Effect.succeed({
							manifest: manifest.data,
							format: response.value.format,
							javascript: response.value.javascript,
						} satisfies CompiledSandboxModule);
					}),
				),
			);
		};

		return { compile };
	}),
}) {}
