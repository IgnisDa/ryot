import { Effect, FileSystem } from "effect";

const peakResidentBytes = Effect.gen(function* () {
	if (process.platform === "linux") {
		const fs = yield* FileSystem.FileSystem;
		const status = yield* fs.readFileString("/proc/self/status");
		const peak = status.match(/^VmHWM:\s+(\d+) kB$/m)?.[1];
		if (peak === undefined) {
			return yield* Effect.die(
				new Error("Process status does not contain a resident memory high-water mark"),
			);
		}
		return Number(peak) * 1024;
	}
	return yield* Effect.sync(() => process.resourceUsage().maxRSS * 1024);
});

export const reportProcessMemory = Effect.fn(function* (phase: string) {
	const peakRssBytes = yield* peakResidentBytes;
	const memory = yield* Effect.sync(() => ({ phase, ...process.memoryUsage(), peakRssBytes }));
	yield* Effect.logInfo(memory);
	return memory;
});
