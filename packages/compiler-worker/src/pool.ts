import {
	Duration,
	Effect,
	Exit,
	Fiber,
	FileSystem,
	Option,
	Path,
	Queue,
	Schema,
	Scope,
	Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { preferAsOomVictim, processTreeCpuMs, processTreeMemoryBytes } from "./process";
import { COMPILER_WORKER_READY, VERIFY_ENVIRONMENT_ARGUMENT } from "./protocol";

export type CompilerWorkerJob = { readonly jobId: string; readonly parentPath: string };

export type CompilerJobFailure = "MemoryExceeded" | "OutputExceeded" | "CpuTimeExceeded";

export type CompilerWorkerPoolOptions<E> = {
	readonly path: string;
	readonly size: number;
	/** Filename-safe name used for logs and the pool's workspace directory. */
	readonly label: string;
	/** Per-job CPU time of the worker's process tree. */
	readonly cpuTimeMs: number;
	/** Per-job elapsed time, so an overloaded host reports unavailability instead of failing the source. */
	readonly timeoutMs: number;
	readonly memoryBytes: number;
	readonly outputBytes: number;
	readonly idleTimeoutMs: number;
	readonly startupTimeoutMs: number;
	readonly recycleMemoryBytes: number;
	readonly goMemoryLimitBytes: number;
	readonly verifyEnvironment?: boolean;
	readonly workspaceDirectory?: string;
	readonly memoryPollIntervalMs: number;
	readonly env: Readonly<Record<string, string>>;
	readonly jobFailure: (failure: CompilerJobFailure) => E;
};

type Slot = { busy: boolean; worker: Worker | undefined; idle: undefined | Fiber.Fiber<void> };

type WorkerEvent =
	| { readonly type: "exit" }
	| { readonly type: "output-exceeded" }
	| { readonly line: string; readonly type: "line" };

type Worker = {
	readonly pid: number;
	readonly stderr: () => string;
	readonly exited: () => boolean;
	readonly scope: Scope.Closeable;
	readonly input: Queue.Queue<Uint8Array>;
	readonly events: Queue.Queue<WorkerEvent>;
};

type JobOutcome =
	| { readonly _tag: "Timeout" }
	| { readonly _tag: "ProcessExited" }
	| { readonly _tag: CompilerJobFailure }
	| { readonly _tag: "MemorySupervisionFailed" }
	| { readonly line: string; readonly _tag: "Response" };

export class CompilerWorkerUnavailable extends Schema.TaggedError<
	CompilerWorkerUnavailable,
	{ readonly brand: unique symbol }
>()("CompilerWorkerUnavailable", { message: Schema.String }) {}

const BUN_ARGUMENTS = ["--smol", "--no-orphans", "--no-install", "--no-env-file"];
const STDERR_TAIL_CHARACTERS = 4096;
const PROCESS_EXIT_GRACE_MS = 50;
const CPU_POLL_INTERVAL_MS = 50;
const NEWLINE = 10;
const encoder = new TextEncoder();

const concatenate = (parts: readonly Uint8Array[], byteLength: number) => {
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.byteLength;
	}
	return bytes;
};

const readLines = (
	stdout: Stream.Stream<Uint8Array, unknown>,
	events: Queue.Queue<WorkerEvent>,
	lineBytes: number,
) => {
	const decoder = new TextDecoder();
	let pending: Uint8Array[] = [];
	let pendingBytes = 0;
	let exceeded = false;
	const append = (part: Uint8Array) =>
		Effect.gen(function* () {
			pendingBytes += part.byteLength;
			if (pendingBytes > lineBytes) {
				exceeded = true;
				pending = [];
				yield* Queue.offer(events, { type: "output-exceeded" });
				return false;
			}
			pending.push(part.slice());
			return true;
		});
	return stdout.pipe(
		Stream.runForEach((chunk) =>
			Effect.gen(function* () {
				if (exceeded) {
					return;
				}
				let start = 0;
				let newline = chunk.indexOf(NEWLINE);
				while (newline !== -1) {
					if (!(yield* append(chunk.subarray(start, newline)))) {
						return;
					}
					const line = decoder.decode(concatenate(pending, pendingBytes));
					pending = [];
					pendingBytes = 0;
					yield* Queue.offer(events, { line, type: "line" });
					start = newline + 1;
					newline = chunk.indexOf(NEWLINE, start);
				}
				if (start < chunk.byteLength) {
					yield* append(chunk.subarray(start));
				}
			}),
		),
		Effect.ignore,
	);
};

export const makeCompilerWorkerPool = Effect.fnUntraced(function* <E>(
	options: CompilerWorkerPoolOptions<E>,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const poolScope = yield* Scope.Scope;
	const parentPath = yield* fs.makeTempDirectoryScoped({
		prefix: `ryot-${options.label}-`,
		...(options.workspaceDirectory === undefined ? {} : { directory: options.workspaceDirectory }),
	});
	const annotations = { compiler: options.label };

	const spawnWorker = (scope: Scope.Closeable) =>
		Effect.gen(function* () {
			const input = yield* Queue.unbounded<Uint8Array>();
			const events = yield* Queue.unbounded<WorkerEvent>();
			const handle = yield* spawner.spawn(
				ChildProcess.make(
					process.execPath,
					[
						...BUN_ARGUMENTS,
						options.path,
						...(options.verifyEnvironment ? [VERIFY_ENVIRONMENT_ARGUMENT] : []),
					],
					{
						stdout: "pipe",
						stderr: "pipe",
						stdin: Stream.fromQueue(input),
						env: { ...options.env, GOMEMLIMIT: String(options.goMemoryLimitBytes) },
					},
				),
			);
			yield* Effect.addFinalizer(() => handle.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore));
			const pid = Number(handle.pid);
			yield* preferAsOomVictim(pid);
			let stderr = "";
			let exited = false;
			const stderrFiber = yield* handle.stderr.pipe(
				Stream.decodeText(),
				Stream.runForEach((chunk) =>
					Effect.sync(() => {
						stderr = `${stderr}${chunk}`.slice(-STDERR_TAIL_CHARACTERS);
					}),
				),
				Effect.ignore,
				Effect.forkScoped,
			);
			yield* readLines(handle.stdout, events, options.outputBytes).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						exited = true;
					}).pipe(Effect.andThen(Queue.offer(events, { type: "exit" }))),
				),
				Effect.forkScoped,
			);
			const worker: Worker = {
				pid,
				input,
				scope,
				events,
				stderr: () => stderr,
				exited: () => exited,
			};
			const ready = yield* Queue.take(events).pipe(
				Effect.timeoutOrElse({
					orElse: () => Effect.succeed(null),
					duration: Duration.millis(options.startupTimeoutMs),
				}),
			);
			if (ready?.type === "line" && ready.line === COMPILER_WORKER_READY) {
				return worker;
			}
			yield* Fiber.join(stderrFiber).pipe(
				Effect.timeoutOrElse({
					orElse: () => Effect.void,
					duration: Duration.millis(PROCESS_EXIT_GRACE_MS),
				}),
			);
			const reason =
				ready === null
					? `did not become ready within ${options.startupTimeoutMs}ms`
					: "failed to start";
			yield* Effect.logWarning(`compiler worker ${reason}`).pipe(
				Effect.annotateLogs({ ...annotations, pid, stderr }),
			);
			return yield* new CompilerWorkerUnavailable({
				message: `The ${options.label} worker ${reason}`,
			});
		});

	const startWorker = Effect.gen(function* () {
		const scope = yield* Scope.make();
		const startedAt = performance.now();
		const worker = yield* spawnWorker(scope).pipe(
			Scope.provide(scope),
			Effect.catchIf(
				(error) => !(error instanceof CompilerWorkerUnavailable),
				(error) =>
					Effect.logWarning("compiler worker could not be started").pipe(
						Effect.annotateLogs({ ...annotations, error: String(error) }),
						Effect.andThen(
							Effect.fail(
								new CompilerWorkerUnavailable({
									message: `The ${options.label} worker could not be started`,
								}),
							),
						),
					),
			),
			Effect.onError(() => Scope.close(scope, Exit.void)),
		);
		yield* Effect.logInfo("compiler worker ready").pipe(
			Effect.annotateLogs({
				...annotations,
				pid: worker.pid,
				startupMs: Math.round(performance.now() - startedAt),
			}),
		);
		return worker;
	});

	const memoryBytes = (worker: Worker) =>
		process.platform === "linux" ? processTreeMemoryBytes(fs, worker.pid) : Effect.succeedSome(0);

	const superviseMemory = (worker: Worker) => {
		const poll: Effect.Effect<"MemoryExceeded" | "MemorySupervisionFailed"> = Effect.gen(
			function* () {
				const bytes = yield* memoryBytes(worker);
				if (Option.isNone(bytes)) {
					yield* Effect.sleep(Duration.millis(PROCESS_EXIT_GRACE_MS));
					return worker.exited() ? yield* Effect.never : "MemorySupervisionFailed";
				}
				if (bytes.value > options.memoryBytes) {
					return "MemoryExceeded";
				}
				yield* Effect.sleep(Duration.millis(options.memoryPollIntervalMs));
				return yield* poll;
			},
		);
		return poll;
	};

	const superviseCpu = (worker: Worker): Effect.Effect<"CpuTimeExceeded"> => {
		if (process.platform !== "linux") {
			return Effect.sleep(Duration.millis(options.cpuTimeMs)).pipe(Effect.as("CpuTimeExceeded"));
		}
		const used = processTreeCpuMs(fs, worker.pid);
		return Effect.gen(function* () {
			const start = yield* used;
			if (Option.isNone(start)) {
				return yield* Effect.never;
			}
			const poll: Effect.Effect<"CpuTimeExceeded"> = Effect.gen(function* () {
				yield* Effect.sleep(Duration.millis(CPU_POLL_INTERVAL_MS));
				const current = yield* used;
				if (Option.isNone(current)) {
					return yield* Effect.never;
				}
				return current.value - start.value > options.cpuTimeMs ? "CpuTimeExceeded" : yield* poll;
			});
			return yield* poll;
		});
	};

	const execute = (worker: Worker, request: string) =>
		Effect.raceAll([
			Queue.offer(worker.input, encoder.encode(`${request}\n`)).pipe(
				Effect.andThen(Queue.take(worker.events)),
				Effect.map((event): JobOutcome => {
					if (event.type === "line") {
						return { line: event.line, _tag: "Response" };
					}
					return { _tag: event.type === "exit" ? "ProcessExited" : "OutputExceeded" };
				}),
			),
			superviseMemory(worker).pipe(Effect.map((tag): JobOutcome => ({ _tag: tag }))),
			superviseCpu(worker).pipe(Effect.map((tag): JobOutcome => ({ _tag: tag }))),
		]).pipe(
			Effect.timeoutOrElse({
				duration: Duration.millis(options.timeoutMs),
				orElse: () => Effect.succeed<JobOutcome>({ _tag: "Timeout" }),
			}),
		);

	const retire = (slot: Slot) =>
		Effect.suspend(() => {
			const worker = slot.worker;
			slot.worker = undefined;
			return worker === undefined ? Effect.void : Scope.close(worker.scope, Exit.void);
		});

	const slots: Slot[] = Array.from({ length: options.size }, () => ({
		busy: false,
		idle: undefined,
		worker: undefined,
	}));
	let jobs = 0;
	const available = yield* Queue.unbounded<Slot>();
	yield* Queue.offerAll(available, slots);
	yield* Effect.addFinalizer(() =>
		Effect.forEach(
			slots,
			(slot) =>
				(slot.idle === undefined ? Effect.void : Fiber.interrupt(slot.idle)).pipe(
					Effect.andThen(retire(slot)),
				),
			{ discard: true },
		),
	);

	const runJob = <E2>(slot: Slot, encode: (job: CompilerWorkerJob) => Effect.Effect<string, E2>) =>
		Effect.gen(function* () {
			if (slot.idle !== undefined) {
				yield* Fiber.interrupt(slot.idle);
				slot.idle = undefined;
			}
			if (slot.worker?.exited()) {
				yield* retire(slot);
			}
			const worker = slot.worker ?? (yield* startWorker);
			slot.worker = worker;
			jobs += 1;
			const jobId = `job-${jobs}`;
			return yield* Effect.acquireUseRelease(
				Effect.succeed(path.join(parentPath, jobId)),
				() =>
					Effect.gen(function* () {
						const request = yield* encode({ jobId, parentPath });
						const startedAt = performance.now();
						slot.busy = true;
						const outcome = yield* execute(worker, request);
						slot.busy = false;
						if (outcome._tag === "Response") {
							const bytes = yield* memoryBytes(worker);
							if (Option.isSome(bytes) && bytes.value > options.recycleMemoryBytes) {
								yield* Effect.logInfo("compiler worker recycled").pipe(
									Effect.annotateLogs({
										...annotations,
										pid: worker.pid,
										memoryBytes: bytes.value,
									}),
								);
								yield* retire(slot);
							}
							return outcome.line;
						}
						yield* Effect.logWarning("compiler worker job failed").pipe(
							Effect.annotateLogs({
								...annotations,
								pid: worker.pid,
								failure: outcome._tag,
								stderr: worker.stderr(),
								elapsedMs: Math.round(performance.now() - startedAt),
							}),
						);
						yield* retire(slot);
						if (outcome._tag === "Timeout") {
							return yield* new CompilerWorkerUnavailable({
								message: `The ${options.label} worker did not finish within ${options.timeoutMs}ms`,
							});
						}
						if (outcome._tag === "ProcessExited" || outcome._tag === "MemorySupervisionFailed") {
							return yield* new CompilerWorkerUnavailable({
								message:
									outcome._tag === "ProcessExited"
										? `The ${options.label} worker exited before returning a result`
										: `The ${options.label} worker's memory could not be supervised`,
							});
						}
						return yield* Effect.fail(options.jobFailure(outcome._tag));
					}),
				(directory) =>
					fs
						.remove(directory, { force: true, recursive: true })
						.pipe(
							Effect.catch((error) =>
								Effect.logWarning("compiler job workspace could not be removed").pipe(
									Effect.annotateLogs({ ...annotations, directory, error: String(error) }),
								),
							),
						),
			);
		});

	const release = (slot: Slot) =>
		Effect.gen(function* () {
			if (slot.busy) {
				slot.busy = false;
				yield* retire(slot);
			}
			if (slot.worker !== undefined) {
				slot.idle = yield* Effect.sleep(Duration.millis(options.idleTimeoutMs)).pipe(
					Effect.andThen(retire(slot)),
					Effect.forkIn(poolScope),
				);
			}
			yield* Queue.offer(available, slot);
		});

	return {
		run: <E2>(encode: (job: CompilerWorkerJob) => Effect.Effect<string, E2>) =>
			Effect.acquireUseRelease(Queue.take(available), (slot) => runJob(slot, encode), release),
	};
});
