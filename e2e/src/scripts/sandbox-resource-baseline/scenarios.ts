import { Schema } from "effect";

import { BenchmarkWorkloadContext } from "./workload-sources";

const KiB = 1024;
const MINUTE_MS = 60_000;

export const CONCURRENCY_CANDIDATES = [1, 2, 3, 5] as const;
export const DEFAULT_WORKER_CONCURRENCY = 2;

export const ScenarioKind = Schema.Literals([
	"idle",
	"hermetic-matrix",
	"live-matrix",
	"live-variance",
	"profile",
	"soak",
]);
export type ScenarioKind = typeof ScenarioKind.Type;

export const Submission = Schema.Literals([
	"none",
	"direct",
	"import",
	"live-import",
	"live-search",
	"live-details",
]);
export type Submission = typeof Submission.Type;

export const LiveSearch = Schema.Struct({
	query: Schema.String,
	pageSize: Schema.Int,
	providerSlug: Schema.String,
});

export const LIVE_SEARCH = { pageSize: 20, query: "furious", providerSlug: "music.youtube-music" };

export const ScenarioDefinition = Schema.Struct({
	id: Schema.String,
	waves: Schema.Int,
	kind: ScenarioKind,
	submission: Submission,
	repetitions: Schema.Int,
	requestCount: Schema.Int,
	description: Schema.String,
	sequential: Schema.Boolean,
	idleDurationMs: Schema.Int,
	recoveryWindowMs: Schema.Int,
	workerConcurrency: Schema.Int,
	liveSearch: Schema.NullOr(LiveSearch),
	schedulerDispatchersDisabled: Schema.Boolean,
	recoveryCheckpointsMs: Schema.Array(Schema.Int),
	workload: Schema.NullOr(BenchmarkWorkloadContext),
	processClass: Schema.Literals(["fresh-process", "long-lived-process"]),
});
export type ScenarioDefinition = typeof ScenarioDefinition.Type;

const workload = (overrides: Partial<BenchmarkWorkloadContext> = {}): BenchmarkWorkloadContext => ({
	seed: 1,
	perCallDelayMs: 0,
	suggestionCount: 0,
	durableHostCalls: 0,
	payloadBytes: 1 * KiB,
	relatedEntityCount: 0,
	terminalOutcome: "success",
	...overrides,
});

export const HERMETIC_MATRIX_WORKLOAD = workload({
	seed: 61,
	perCallDelayMs: 25,
	durableHostCalls: 5,
});

export const STANDARD_IMPORT_WORKLOAD = workload({
	seed: 71,
	perCallDelayMs: 25,
	suggestionCount: 10,
	durableHostCalls: 5,
	relatedEntityCount: 10,
});

const base = {
	waves: 1,
	workload: null,
	requestCount: 0,
	liveSearch: null,
	idleDurationMs: 0,
	sequential: false,
	submission: "none",
	recoveryCheckpointsMs: [],
	processClass: "fresh-process",
	recoveryWindowMs: 5 * MINUTE_MS,
	schedulerDispatchersDisabled: true,
	workerConcurrency: DEFAULT_WORKER_CONCURRENCY,
} as const;

const idle = (dispatchersDisabled: boolean): ScenarioDefinition => ({
	...base,
	kind: "idle",
	repetitions: 5,
	recoveryWindowMs: 0,
	idleDurationMs: 10 * MINUTE_MS,
	schedulerDispatchersDisabled: dispatchersDisabled,
	id: dispatchersDisabled ? "idle-dispatchers-disabled" : "idle-dispatchers-enabled",
	description: `Fresh process idle for ten minutes with dispatchers ${dispatchersDisabled ? "disabled" : "enabled"}`,
});

export const hermeticScenarioId = (concurrency: number) => `hermetic-c${concurrency}`;
export const liveScenarioId = (concurrency: number) => `live-c${concurrency}`;

const hermetic = (concurrency: number): ScenarioDefinition => ({
	...base,
	repetitions: 5,
	requestCount: 20,
	submission: "direct",
	kind: "hermetic-matrix",
	workerConcurrency: concurrency,
	workload: HERMETIC_MATRIX_WORKLOAD,
	id: hermeticScenarioId(concurrency),
	description: `Twenty direct executions with five 25 ms durable host calls at worker concurrency ${concurrency}`,
});

const live = (concurrency: number): ScenarioDefinition => ({
	...base,
	repetitions: 3,
	requestCount: 20,
	kind: "live-matrix",
	liveSearch: LIVE_SEARCH,
	submission: "live-import",
	workerConcurrency: concurrency,
	id: liveScenarioId(concurrency),
	description: `One live YouTube Music search then all twenty imports at worker concurrency ${concurrency}`,
});

const variance = (submission: "live-search" | "live-details"): ScenarioDefinition => ({
	...base,
	submission,
	repetitions: 1,
	sequential: true,
	requestCount: 30,
	workerConcurrency: 1,
	kind: "live-variance",
	liveSearch: LIVE_SEARCH,
	processClass: "long-lived-process",
	id: submission === "live-search" ? "ytm-search-variance" : "ytm-details-variance",
	description: `Thirty unprofiled sequential YouTube Music ${submission === "live-search" ? "searches" : "details executions"}`,
});

const soak = (input: {
	readonly id: string;
	readonly description: string;
	readonly requestCount: number;
	readonly sequential: boolean;
	readonly submission: Submission;
	readonly workload: BenchmarkWorkloadContext | null;
}): ScenarioDefinition => ({
	...base,
	...input,
	waves: 10,
	kind: "soak",
	repetitions: 1,
	idleDurationMs: 10 * MINUTE_MS,
	recoveryWindowMs: 15 * MINUTE_MS,
	processClass: "long-lived-process",
	liveSearch: input.submission === "live-details" ? LIVE_SEARCH : null,
	recoveryCheckpointsMs: [1 * MINUTE_MS, 5 * MINUTE_MS, 15 * MINUTE_MS],
});

export const IDLE_SCENARIOS = [idle(true), idle(false)];
export const HERMETIC_SCENARIOS = CONCURRENCY_CANDIDATES.map(hermetic);
export const LIVE_SCENARIOS = CONCURRENCY_CANDIDATES.map(live);
export const VARIANCE_SCENARIOS = [variance("live-search"), variance("live-details")];

export const SOAK_SCENARIOS = [
	soak({
		requestCount: 10,
		sequential: true,
		id: "soak-control",
		submission: "direct",
		workload: workload({ seed: 81 }),
		description: "Ten waves of ten sequential direct executions without host calls",
	}),
	soak({
		requestCount: 20,
		sequential: false,
		submission: "import",
		id: "soak-hermetic-import",
		workload: STANDARD_IMPORT_WORKLOAD,
		description: "Ten waves of twenty standard provider imports with unique identities",
	}),
	soak({
		workload: null,
		requestCount: 20,
		sequential: false,
		id: "soak-live-details",
		submission: "live-details",
		description: "Ten waves of twenty live YouTube Music details executions in rotating order",
	}),
];

export const PROFILE_SCENARIOS: ReadonlyArray<ScenarioDefinition> = [
	{
		...base,
		repetitions: 1,
		kind: "profile",
		requestCount: 1,
		submission: "direct",
		workerConcurrency: 1,
		id: "profile-hermetic-noop",
		workload: workload({ seed: 91 }),
		description: "One profiled hermetic execution without host calls",
	},
	{
		...base,
		repetitions: 1,
		kind: "profile",
		requestCount: 1,
		workerConcurrency: 1,
		liveSearch: LIVE_SEARCH,
		id: "profile-ytm-search",
		submission: "live-search",
		description: "One profiled YouTube Music search",
	},
	{
		...base,
		repetitions: 1,
		kind: "profile",
		requestCount: 1,
		workerConcurrency: 1,
		liveSearch: LIVE_SEARCH,
		id: "profile-ytm-details",
		submission: "live-details",
		description: "One profiled YouTube Music details execution",
	},
	{
		...base,
		repetitions: 1,
		kind: "profile",
		requestCount: 5,
		workerConcurrency: 5,
		liveSearch: LIVE_SEARCH,
		submission: "live-details",
		id: "profile-ytm-details-five",
		description: "Five concurrent details executions with one profiled worker",
	},
];

export const ALL_SCENARIOS: ReadonlyArray<ScenarioDefinition> = [
	...IDLE_SCENARIOS,
	...HERMETIC_SCENARIOS,
	...LIVE_SCENARIOS,
	...VARIANCE_SCENARIOS,
	...PROFILE_SCENARIOS,
	...SOAK_SCENARIOS,
];

export const findScenario = (id: string) => {
	const scenario = ALL_SCENARIOS.find((candidate) => candidate.id === id);
	if (scenario === undefined) {
		throw new Error(`Unknown scenario ${id}`);
	}
	return scenario;
};

/**
 * Williams design for four conditions: every value appears once in each position and every ordered
 * adjacent pair appears once across the first four rounds. A fifth round reverses the first.
 */
const WILLIAMS_ROWS = [
	[0, 1, 3, 2],
	[1, 2, 0, 3],
	[2, 3, 1, 0],
	[3, 0, 2, 1],
] as const;

export const counterbalancedOrder = (values: ReadonlyArray<number>, rounds: number) => {
	if (values.length !== 4) {
		throw new Error("The counterbalanced design is defined for exactly four conditions");
	}
	return Array.from({ length: rounds }, (_unused, round) => {
		const row = WILLIAMS_ROWS[round % WILLIAMS_ROWS.length] ?? WILLIAMS_ROWS[0];
		const ordered = row.map((index) => values[index] ?? 0);
		return round >= WILLIAMS_ROWS.length ? ordered.toReversed() : ordered;
	});
};
