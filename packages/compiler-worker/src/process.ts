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

const descendantsTotal = (
	fs: FileSystem.FileSystem,
	pid: number,
	visited: Set<number>,
	measure: (pid: number) => Effect.Effect<number>,
): Effect.Effect<number> =>
	childPids(fs, pid).pipe(
		Effect.flatMap((pids) =>
			Effect.forEach(
				pids.filter((childPid) => !visited.has(childPid)),
				(childPid) =>
					Effect.gen(function* () {
						visited.add(childPid);
						return (
							(yield* measure(childPid)) + (yield* descendantsTotal(fs, childPid, visited, measure))
						);
					}),
				{ concurrency: "unbounded" },
			),
		),
		Effect.map((values) => values.reduce((total, value) => total + value, 0)),
	);

const processTreeTotal = (
	fs: FileSystem.FileSystem,
	pid: number,
	file: string,
	parse: (contents: string) => number,
) =>
	fs.readFileString(`/proc/${pid}/${file}`).pipe(
		Effect.option,
		Effect.flatMap(
			Option.match({
				onNone: () => Effect.succeed(Option.none<number>()),
				onSome: (contents) =>
					descendantsTotal(fs, pid, new Set([pid]), (childPid) =>
						fs.readFileString(`/proc/${childPid}/${file}`).pipe(
							Effect.map(parse),
							Effect.orElseSucceed(() => 0),
						),
					).pipe(Effect.map((descendants) => Option.some(parse(contents) + descendants))),
			}),
		),
	);

// procfs reports CPU time in USER_HZ ticks, which Linux fixes at 100 per second for userspace.
const CPU_TICK_MS = 10;

const cpuMilliseconds = (stat: string) => {
	const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
	return (Number(fields[11] ?? 0) + Number(fields[12] ?? 0)) * CPU_TICK_MS;
};

/** Linux proportional set size of a process tree; none when the root's procfs entry is gone. */
export const processTreeMemoryBytes = (fs: FileSystem.FileSystem, pid: number) =>
	processTreeTotal(fs, pid, "smaps_rollup", proportionalBytes);

/** Linux CPU time used by a process tree's live processes; none when the root's procfs entry is gone. */
export const processTreeCpuMs = (fs: FileSystem.FileSystem, pid: number) =>
	processTreeTotal(fs, pid, "stat", cpuMilliseconds);
