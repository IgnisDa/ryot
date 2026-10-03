import { Effect } from "effect";

export const parseProcStatusRssBytes = (contents: string) => {
	const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(contents);
	return match?.[1] ? Number(match[1]) * 1024 : null;
};

export const parseCgroupMemoryMax = (contents: string) => {
	const value = contents.trim();
	if (value === "max") {
		return null;
	}
	const maximum = Number(value);
	return value !== "" && Number.isFinite(maximum) ? maximum : null;
};

const readTextFile = (path: string) =>
	Effect.tryPromise(() => Bun.file(path).text()).pipe(Effect.orElseSucceed(() => null));

export const readProcessRssBytes = (pid: number) =>
	Effect.map(readTextFile(`/proc/${pid}/status`), (status) =>
		status === null ? null : parseProcStatusRssBytes(status),
	);

// An absent cgroup returns undefined; an unlimited cgroup returns null.
export const readCgroupMemoryLimit = Effect.gen(function* () {
	const current = yield* readTextFile("/sys/fs/cgroup/memory.current");
	if (current === null || current.trim() === "" || !Number.isFinite(Number(current.trim()))) {
		return undefined;
	}
	const maximum = yield* readTextFile("/sys/fs/cgroup/memory.max");
	return maximum === null ? null : parseCgroupMemoryMax(maximum);
});
