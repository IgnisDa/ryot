import { Duration, Effect, Fiber, FileSystem, Ref, Result, Stream, type Semaphore } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const encoder = new TextEncoder();

export type CompilerWorkerFailure =
	| { readonly _tag: "Timeout" }
	| { readonly _tag: "ProcessExited" }
	| { readonly _tag: "MemoryExceeded" }
	| { readonly _tag: "OutputExceeded" }
	| { readonly _tag: "ProcessUnavailable" }
	| { readonly _tag: "MemorySupervisionFailed" };

const readProportionalBytes = (memory: string) => {
	const match = /^Pss:\s+(\d+)\s+kB$/m.exec(memory);
	return match?.[1] ? Number(match[1]) * 2 ** 10 : 0;
};

const processTreeMemoryBytes = (
	fs: FileSystem.FileSystem,
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
			(yield* fs.readFileString(`/proc/${pid}/smaps_rollup`).pipe(Effect.orElseSucceed(() => "")));
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
			(childPid) => processTreeMemoryBytes(fs, childPid, visited),
			{ concurrency: "unbounded" },
		);
		return readProportionalBytes(memory) + childBytes.reduce((total, bytes) => total + bytes, 0);
	});

export const makeCompilerWorkerRunner = <E>(options: {
	readonly path: string;
	readonly timeoutMs: number;
	readonly memoryBytes: number;
	readonly stdoutBytes?: number;
	readonly memoryPollIntervalMs: number;
	readonly semaphore: Semaphore.Semaphore;
	readonly failure: (failure: CompilerWorkerFailure) => E;
}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

		const execute = (input: string) =>
			Effect.scoped(
				Effect.gen(function* () {
					const worker = yield* spawner.spawn(
						ChildProcess.make(
							process.execPath,
							["--smol", "--no-orphans", "--no-install", "--no-env-file", options.path],
							{ stdout: "pipe", stderr: "pipe", stdin: Stream.succeed(encoder.encode(input)) },
						),
					);
					yield* Effect.addFinalizer(() =>
						worker.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore),
					);

					const stdoutExceeded = yield* Ref.make(false);
					let stdoutByteLength = 0;
					const stdout = yield* worker.stdout.pipe(
						Stream.decodeText({ encoding: "utf-8" }),
						Stream.runFoldEffect(
							() => "",
							(output, chunk) => {
								const next = output + chunk;
								stdoutByteLength += encoder.encode(chunk).byteLength;
								if (options.stdoutBytes !== undefined && stdoutByteLength > options.stdoutBytes) {
									return Ref.set(stdoutExceeded, true).pipe(
										Effect.andThen(worker.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore)),
										Effect.as(output),
									);
								}
								return Effect.succeed(next);
							},
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
								yield* Effect.sleep(Duration.millis(options.memoryPollIntervalMs));
								return;
							}
							const memoryBytes = yield* processTreeMemoryBytes(
								fs,
								pid,
								new Set(),
								rootMemory.success,
							);
							if (memoryBytes > options.memoryBytes) {
								yield* Ref.set(memoryExceeded, true);
								yield* worker.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore);
							}
							yield* Effect.sleep(Duration.millis(options.memoryPollIntervalMs));
						}).pipe(Effect.forever, Effect.forkScoped);
					}

					const exitCode = yield* Effect.result(worker.exitCode);
					if (yield* Ref.get(memoryExceeded)) {
						return { failure: "MemoryExceeded" } as const;
					}
					if (yield* Ref.get(stdoutExceeded)) {
						return { failure: "OutputExceeded" } as const;
					}
					if (yield* Ref.get(memorySupervisionFailed)) {
						return { failure: "MemorySupervisionFailed" } as const;
					}
					if (Result.isFailure(exitCode) || Number(exitCode.success) !== 0) {
						return { failure: "ProcessExited" } as const;
					}
					const output = yield* Fiber.join(stdout);
					yield* Fiber.join(stderr);
					return { output } as const;
				}),
			).pipe(
				Effect.mapError(() => options.failure({ _tag: "ProcessUnavailable" })),
				Effect.flatMap((result) =>
					"output" in result
						? Effect.succeed(result.output)
						: Effect.fail(options.failure({ _tag: result.failure })),
				),
			);

		return (input: string) =>
			options.semaphore.withPermits(1)(
				execute(input).pipe(
					Effect.timeoutOrElse({
						duration: Duration.millis(options.timeoutMs),
						orElse: () => Effect.fail(options.failure({ _tag: "Timeout" })),
					}),
				),
			);
	});
