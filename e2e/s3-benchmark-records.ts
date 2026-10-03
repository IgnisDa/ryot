import { Schema } from "effect";

export const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

// Nearest-rank percentile: the smallest sample with at least p percent of samples at or below it.
export const percentile = (values: ReadonlyArray<number>, p: number) => {
	const sorted = [...values].sort((left, right) => left - right);
	const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
	return sorted[Math.min(sorted.length, rank) - 1] ?? Number.NaN;
};

export const LATENCY_MODES = ["unloaded", "loaded"] as const;
export const ENDPOINTS = ["search", "details"] as const;

const Millis = Schema.Finite;

const MetricPoint = Schema.Struct({
	sum: Schema.NullOr(Millis),
	count: Schema.NullOr(Millis),
	value: Schema.NullOr(Millis),
	bounds: Schema.Array(Millis),
	buckets: Schema.Array(Millis),
	attributes: Schema.Record(Schema.String, Schema.String),
});

export const MetricSnapshot = Schema.Struct({
	atMs: Millis,
	metrics: Schema.Record(Schema.String, Schema.Array(MetricPoint)),
});
export type MetricSnapshot = typeof MetricSnapshot.Type;

export const LatencySample = Schema.Struct({
	index: Schema.Int,
	durationMs: Millis,
	startedAtMs: Millis,
	input: Schema.String,
	ticketWaitMs: Schema.NullOr(Millis),
	httpArrivalMs: Schema.NullOr(Millis),
	resumeDelayMs: Schema.NullOr(Millis),
	executionId: Schema.NullOr(Schema.String),
});
export type LatencySample = typeof LatencySample.Type;

export const HostSample = Schema.Struct({
	atMs: Millis,
	serverTreeRssMiB: Millis,
	activeExecutions: Millis,
	totalConnections: Millis,
	activeConnections: Millis,
	cpuBusy: Schema.NullOr(Millis),
	lockWaitingConnections: Millis,
});
export type HostSample = typeof HostSample.Type;

const BackgroundProgressSample = Schema.Struct({
	atMs: Millis,
	httpRequests: Millis,
	gatesCompleted: Millis,
});

export const Configuration = Schema.Record(Schema.String, Schema.Union([Schema.String, Millis]));

export const LatencyTrialRecord = Schema.Struct({
	pair: Schema.Int,
	resolutionMs: Millis,
	startedAt: Schema.String,
	measureEndedAtMs: Millis,
	measureStartedAtMs: Millis,
	configuration: Configuration,
	host: Schema.Array(HostSample),
	kind: Schema.Literal("latency"),
	mode: Schema.Literals(LATENCY_MODES),
	metrics: Schema.Array(MetricSnapshot),
	warmup: Schema.Struct({ search: Schema.Int, details: Schema.Int }),
	samples: Schema.Struct({
		search: Schema.Array(LatencySample),
		details: Schema.Array(LatencySample),
	}),
	hashes: Schema.Struct({
		inputs: Schema.String,
		sources: Schema.Record(Schema.String, Schema.String),
	}),
	background: Schema.Struct({
		maxStallMs: Millis,
		gatesFailed: Millis,
		gatesStarted: Millis,
		gatesCompleted: Millis,
		continuous: Schema.Boolean,
		progress: Schema.Array(BackgroundProgressSample),
	}),
	saturation: Schema.Struct({
		windowMs: Millis,
		threshold: Millis,
		proven: Schema.Boolean,
		required: Schema.Boolean,
		reachedAtMs: Schema.NullOr(Millis),
		minRollingBusy: Schema.NullOr(Millis),
		measurementBusy: Schema.NullOr(Millis),
	}),
});
export type LatencyTrialRecord = typeof LatencyTrialRecord.Type;

const FairnessUserRecord = Schema.Struct({
	failed: Schema.Int,
	plugins: Schema.Int,
	label: Schema.String,
	completedTotal: Schema.Int,
	admissionsTotal: Schema.Int,
	completedInWindow: Schema.Int,
	admissionsInWindow: Schema.Int,
	latencyP50Ms: Schema.NullOr(Millis),
	latencyP95Ms: Schema.NullOr(Millis),
	failureSamples: Schema.Array(Schema.String),
	progress: Schema.Array(Schema.Struct({ atMs: Millis, completed: Millis, admissions: Millis })),
});

export const FairnessRecord = Schema.Struct({
	windowMs: Millis,
	windowEndedAtMs: Millis,
	startedAt: Schema.String,
	windowStartedAtMs: Millis,
	configuration: Configuration,
	host: Schema.Array(HostSample),
	kind: Schema.Literal("fairness"),
	metrics: Schema.Array(MetricSnapshot),
	users: Schema.Array(FairnessUserRecord),
	tolerance: Schema.Struct({ admissions: Millis, executions: Millis }),
	hashes: Schema.Struct({
		inputs: Schema.String,
		sources: Schema.Record(Schema.String, Schema.String),
	}),
	result: Schema.Struct({
		pass: Schema.Boolean,
		executionDifference: Millis,
		admissionDifference: Millis,
	}),
});
export type FairnessRecord = typeof FairnessRecord.Type;

const LatencyTrialJson = Schema.fromJsonString(LatencyTrialRecord);
const FairnessJson = Schema.fromJsonString(FairnessRecord);
const ExitCodesJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Int));

export const decodeLatencyTrial = Schema.decodeUnknownSync(LatencyTrialJson);
export const encodeLatencyTrial = Schema.encodeSync(LatencyTrialJson);
export const decodeFairness = Schema.decodeUnknownSync(FairnessJson);
export const encodeFairness = Schema.encodeSync(FairnessJson);
export const decodeExitCodes = Schema.decodeUnknownSync(ExitCodesJson);
