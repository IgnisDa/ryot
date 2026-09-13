import { Schema } from "effect";

import { BenchmarkWorkloadContext } from "./workload-sources";

const KiB = 1024;

/** Strictly below `SANDBOX_LIMITS.execution.resultBytes` (4 MiB = 4_194_304 bytes). */
export const LARGE_PAYLOAD_BYTES = 3_900_000;

export const ScenarioGroup = Schema.Literals(["A", "B", "C", "D", "E", "live"]);
export const ScenarioKind = Schema.Literals([
	"idle",
	"direct",
	"import",
	"live-import",
	"restart-recovery",
]);

export const LiveSearch = Schema.Struct({
	query: Schema.String,
	pageSize: Schema.Int,
	providerSlug: Schema.String,
	entitySchemaSlug: Schema.String,
});

export const ScenarioDefinition = Schema.Struct({
	id: Schema.String,
	kind: ScenarioKind,
	group: ScenarioGroup,
	repetitions: Schema.Int,
	concurrency: Schema.Int,
	description: Schema.String,
	idleDurationMs: Schema.Int,
	workload: BenchmarkWorkloadContext,
	liveSearch: Schema.NullOr(LiveSearch),
	requiresManualRestart: Schema.Boolean,
	awaitActiveWorkers: Schema.NullOr(Schema.Int),
	/** Phase 9/10 gates: skip the scenario when the previous scenario ended below this floor. */
	minimumMemAvailableBytes: Schema.NullOr(Schema.Int),
});
export type ScenarioDefinition = typeof ScenarioDefinition.Type;

const baseScenario = {
	repetitions: 5,
	concurrency: 1,
	liveSearch: null,
	idleDurationMs: 0,
	awaitActiveWorkers: null,
	requiresManualRestart: false,
	minimumMemAvailableBytes: null,
} as const;

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

/** Group C's "standard import" as fixed by the plan. */
const standardImportWorkload = workload({
	seed: 3,
	perCallDelayMs: 25,
	suggestionCount: 10,
	durableHostCalls: 5,
	relatedEntityCount: 10,
});

const direct = (
	id: string,
	description: string,
	overrides: Partial<ScenarioDefinition> & { workload: BenchmarkWorkloadContext },
): ScenarioDefinition => ({
	id,
	group: "A",
	description,
	kind: "direct",
	...baseScenario,
	...overrides,
});

export const CANONICAL_SCENARIOS: ReadonlyArray<ScenarioDefinition> = [
	{
		group: "A",
		kind: "idle",
		id: "00-idle",
		...baseScenario,
		repetitions: 1,
		workload: workload(),
		idleDurationMs: 600_000,
		description: "Idle for ten minutes after startup",
	},
	direct("01-direct-no-host", "One direct execution, no host calls, 1 KiB output", {
		workload: workload({ seed: 11 }),
	}),
	direct("02-direct-1-host-call", "One direct execution with 1 durable host call", {
		workload: workload({ seed: 12, durableHostCalls: 1 }),
	}),
	direct("03-direct-5-host-calls", "One direct execution with 5 durable host calls", {
		workload: workload({ seed: 13, durableHostCalls: 5 }),
	}),
	direct("04-direct-10-host-calls", "One direct execution with 10 durable host calls", {
		workload: workload({ seed: 14, durableHostCalls: 10 }),
	}),
	direct("05-direct-1mib-payload", "One direct execution returning 1 MiB", {
		workload: workload({ seed: 15, payloadBytes: 1024 * KiB }),
	}),
	direct("06-direct-large-payload", "One direct execution returning just under 4 MiB", {
		workload: workload({ seed: 16, payloadBytes: LARGE_PAYLOAD_BYTES }),
	}),
	direct("07-concurrency-1", "1 identical five-host-call execution", {
		group: "B",
		concurrency: 1,
		workload: workload({ seed: 21, durableHostCalls: 5 }),
	}),
	direct("08-concurrency-2", "2 concurrent five-host-call executions", {
		group: "B",
		concurrency: 2,
		workload: workload({ seed: 22, durableHostCalls: 5 }),
	}),
	direct("09-concurrency-5", "5 concurrent five-host-call executions", {
		group: "B",
		concurrency: 5,
		workload: workload({ seed: 23, durableHostCalls: 5 }),
	}),
	direct("10-concurrency-20", "20 concurrent five-host-call executions", {
		group: "B",
		concurrency: 20,
		workload: workload({ seed: 24, durableHostCalls: 5 }),
	}),
	{
		...baseScenario,
		group: "C",
		kind: "import",
		id: "11-import-no-related",
		description: "One provider import with no related entities",
		workload: workload({ seed: 31, perCallDelayMs: 25, durableHostCalls: 5 }),
	},
	{
		...baseScenario,
		group: "C",
		kind: "import",
		id: "12-import-10-related",
		workload: standardImportWorkload,
		description: "One provider import with 10 related entities and 10 suggestions",
	},
	{
		...baseScenario,
		group: "C",
		kind: "import",
		id: "13-import-100-related",
		description: "One provider import with 100 related entities and 100 suggestions",
		workload: workload({
			seed: 33,
			perCallDelayMs: 25,
			durableHostCalls: 5,
			suggestionCount: 100,
			relatedEntityCount: 100,
		}),
	},
	{
		...baseScenario,
		group: "C",
		kind: "import",
		concurrency: 2,
		id: "14-import-concurrency-2",
		workload: standardImportWorkload,
		description: "2 concurrent standard imports",
	},
	{
		...baseScenario,
		group: "C",
		kind: "import",
		concurrency: 5,
		id: "15-import-concurrency-5",
		workload: standardImportWorkload,
		description: "5 concurrent standard imports",
	},
	{
		...baseScenario,
		group: "C",
		kind: "import",
		concurrency: 20,
		id: "16-import-concurrency-20",
		workload: standardImportWorkload,
		description: "20 concurrent standard imports",
	},
	{
		...baseScenario,
		group: "D",
		kind: "import",
		concurrency: 5,
		id: "17-typed-failures-5",
		description: "5 concurrent typed provider failures",
		workload: workload({ seed: 41, durableHostCalls: 5, terminalOutcome: "typed-failure" }),
	},
	direct("18-sandbox-timeouts-5", "5 concurrent sandbox timeouts", {
		group: "D",
		concurrency: 5,
		workload: workload({ seed: 42, terminalOutcome: "timeout" }),
	}),
	{
		...baseScenario,
		group: "D",
		kind: "import",
		concurrency: 20,
		id: "19-typed-failures-20",
		description: "20 submitted typed provider failures",
		workload: workload({ seed: 43, durableHostCalls: 5, terminalOutcome: "typed-failure" }),
	},
	{
		...baseScenario,
		group: "E",
		repetitions: 1,
		concurrency: 20,
		awaitActiveWorkers: 5,
		kind: "restart-recovery",
		id: "20-restart-recovery",
		requiresManualRestart: true,
		workload: standardImportWorkload,
		minimumMemAvailableBytes: 768 * KiB * KiB,
		description: "20 standard imports interrupted by a Ryot container restart",
	},
	{
		...baseScenario,
		group: "live",
		repetitions: 1,
		concurrency: 1,
		kind: "live-import",
		workload: workload({ seed: 51 }),
		id: "21-live-youtube-music-single",
		description: "One live YouTube Music import after a fresh database",
		liveSearch: {
			pageSize: 20,
			query: "furious",
			entitySchemaSlug: "music",
			providerSlug: "music.youtube-music",
		},
	},
	{
		...baseScenario,
		group: "live",
		repetitions: 1,
		concurrency: 5,
		kind: "live-import",
		workload: workload({ seed: 52 }),
		id: "22-live-youtube-music-five",
		minimumMemAvailableBytes: 1024 * KiB * KiB,
		description: "Five concurrent live YouTube Music imports after a fresh database",
		liveSearch: {
			pageSize: 20,
			query: "furious",
			entitySchemaSlug: "music",
			providerSlug: "music.youtube-music",
		},
	},
	{
		...baseScenario,
		group: "live",
		repetitions: 1,
		concurrency: 20,
		kind: "live-import",
		workload: workload({ seed: 53 }),
		id: "23-live-youtube-music-twenty",
		minimumMemAvailableBytes: 1024 * KiB * KiB,
		description: "Twenty rapid live YouTube Music imports, run at most once",
		liveSearch: {
			pageSize: 20,
			query: "furious",
			entitySchemaSlug: "music",
			providerSlug: "music.youtube-music",
		},
	},
];
