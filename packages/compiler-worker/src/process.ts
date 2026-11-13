import { Effect, type FileSystem, Option } from "effect";

const CHILD_PROCESS_OOM_SCORE_ADJ = 1000;

/** A memory limit then fails one worker instead of restarting its parent. */
export const preferAsOomVictim = (pid: number) =>
	process.platform === "linux"
		? Effect.tryPromise({
				catch: (error) => String(error),
				try: () => Bun.write(`/proc/${pid}/oom_score_adj`, `${CHILD_PROCESS_OOM_SCORE_ADJ}`),
			}).pipe(
				Effect.asVoid,
				Effect.catch((error) =>
					Effect.logWarning("compiler worker could not be made the preferred OOM victim").pipe(
						Effect.annotateLogs({ pid, error }),
					),
				),
			)
		: Effect.void;

const proportionalBytes = (memory: string) => {
	const match = /^Pss:\s+(\d+)\s+kB$/m.exec(memory);
	return match?.[1] ? Number(match[1]) * 2 ** 10 : 0;
};

const childPids = (fs: FileSystem.FileSystem, pid: number) =>
	fs.readFileString(`/proc/${pid}/task/${pid}/children`).pipe(
		Effect.orElseSucceed(() => ""),
		Effect.map((children) =>
			children
				.trim()
				.split(/\s+/)
				.map(Number)
				.filter((childPid) => Number.isSafeInteger(childPid) && childPid > 0),
		),
	);

const childrenMemoryBytes = (
	fs: FileSystem.FileSystem,
	pid: number,
	visited: Set<number>,
): Effect.Effect<number> =>
	childPids(fs, pid).pipe(
		Effect.flatMap((pids) =>
			Effect.forEach(
				pids.filter((childPid) => !visited.has(childPid)),
				(childPid) =>
					Effect.gen(function* () {
						visited.add(childPid);
						const memory = yield* fs
							.readFileString(`/proc/${childPid}/smaps_rollup`)
							.pipe(Effect.orElseSucceed(() => ""));
						return proportionalBytes(memory) + (yield* childrenMemoryBytes(fs, childPid, visited));
					}),
				{ concurrency: "unbounded" },
			),
		),
		Effect.map((bytes) => bytes.reduce((total, value) => total + value, 0)),
	);

/** Linux proportional set size of a process tree; none when the root's procfs entry is gone. */
export const processTreeMemoryBytes = (fs: FileSystem.FileSystem, pid: number) =>
	fs
		.readFileString(`/proc/${pid}/smaps_rollup`)
		.pipe(
			Effect.option,
			Effect.flatMap(
				Option.match({
					onNone: () => Effect.succeed(Option.none<number>()),
					onSome: (memory) =>
						childrenMemoryBytes(fs, pid, new Set([pid])).pipe(
							Effect.map((childBytes) => Option.some(proportionalBytes(memory) + childBytes)),
						),
				}),
			),
		);
