import { Effect } from "effect";

export const reportProcessMemory = Effect.fn(function* (phase: string) {
	const memory = yield* Effect.sync(() => ({
		phase,
		...process.memoryUsage(),
		peakRssBytes: process.resourceUsage().maxRSS * 1024,
	}));
	yield* Effect.logInfo(memory);
	return memory;
});
