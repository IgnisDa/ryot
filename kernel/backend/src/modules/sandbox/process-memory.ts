import type { FileSystem } from "effect";
import { Effect } from "effect";

const readProportionalBytes = (memory: string) => {
	const match = /^Pss:\s+(\d+)\s+kB$/m.exec(memory);
	return match?.[1] ? Number(match[1]) * 2 ** 10 : 0;
};

export const processTreeMemoryBytes = (
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
