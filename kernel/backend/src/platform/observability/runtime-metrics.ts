import type { SandboxMetricKind } from "@ryot-app/sandbox/host/metrics";
import { Effect, Metric } from "effect";

// Effect metrics carry no dedicated unit field; `OtlpMetrics` reads the OTLP unit from a `unit`
// attribute, so every declaration below states its unit exactly once and inherits it on export.
const BYTES = "By";
const MILLISECONDS = "ms";

const DURATION_BOUNDARIES = [
	1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000,
] as const;

const PHASE_DURATION_BOUNDARIES = [
	10, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 300_000,
] as const;

const JOURNAL_SIZE_BOUNDARIES = [
	1_024, 8_192, 65_536, 524_288, 1_048_576, 10_485_760, 104_857_600,
] as const;

const JOURNAL_ENTRY_BOUNDARIES = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000] as const;

const observe = <Input>(
	metric: Metric.Metric<Input, unknown>,
	attributes: Metric.Metric.Attributes,
	value: Input,
) => Metric.update(Metric.withAttributes(metric, attributes), value);

export type ProviderImportOutcome = "success" | "failure";

/** A body attempt interrupted by workflow suspension is neither a success nor a failure. */
export type ProviderImportAttemptOutcome = "interrupted" | ProviderImportOutcome;

export type SandboxReplayOutcome = "failed" | "missing" | "pending" | "completed";

export type ProviderImportPhase = "population" | "entry-event" | "provider-import-automation";

const sandboxWorkflowReplays = Metric.counter("ryot.sandbox.workflow_replays", {
	incremental: true,
	attributes: { unit: "{replay}" },
	description: "Sandbox workflow replays by outcome",
});

const sandboxWorkflowReplayDuration = Metric.histogram("ryot.sandbox.workflow_replay_duration", {
	attributes: { unit: MILLISECONDS },
	boundaries: [...DURATION_BOUNDARIES],
	description: "Wall-clock duration of one sandbox workflow replay",
});

const sandboxWorkflowJournalSize = Metric.histogram("ryot.sandbox.workflow_journal_size", {
	attributes: { unit: BYTES },
	boundaries: [...JOURNAL_SIZE_BOUNDARIES],
	description: "Journal bytes observed when a sandbox workflow replay finished",
});

const sandboxWorkflowJournalEntries = Metric.histogram("ryot.sandbox.workflow_journal_entries", {
	attributes: { unit: "{entry}" },
	boundaries: [...JOURNAL_ENTRY_BOUNDARIES],
	description: "Journal entries observed when a sandbox workflow replay finished",
});

// Import workflow bodies replay from the start after every suspension or restart, so these three
// metrics count process-local body attempts, never logical imports. Logical import state lives in
// durable workflow persistence.
const providerImportPhaseAttemptDuration = Metric.histogram(
	"ryot.provider_import.phase_attempt_duration",
	{
		attributes: { unit: MILLISECONDS },
		boundaries: [...PHASE_DURATION_BOUNDARIES],
		description: "Duration of one provider import phase attempt inside one workflow body execution",
	},
);

const providerImportExecutingBodies = Metric.gauge("ryot.provider_import.executing_bodies", {
	attributes: { unit: "{execution}" },
	description: "Provider import workflow bodies currently executing in this process",
});

const providerImportBodyOutcomes = Metric.counter("ryot.provider_import.body_outcomes", {
	incremental: true,
	attributes: { unit: "{execution}" },
	description:
		"Provider import workflow body executions that returned or failed; a body re-entered after a restart records again",
});

export const recordSandboxWorkflowReplayFinished = (input: {
	readonly durationMs: number;
	readonly journalBytes: number;
	readonly journalEntries: number;
	readonly kind: SandboxMetricKind;
	readonly outcome: SandboxReplayOutcome;
}) => {
	const attributes = { kind: input.kind, outcome: input.outcome };
	return Effect.all(
		[
			observe(sandboxWorkflowReplays, attributes, 1),
			observe(sandboxWorkflowReplayDuration, attributes, input.durationMs),
			observe(sandboxWorkflowJournalSize, { kind: input.kind }, input.journalBytes),
			observe(sandboxWorkflowJournalEntries, { kind: input.kind }, input.journalEntries),
		],
		{ discard: true },
	);
};

export const recordProviderImportBodyStarted = Metric.modify(providerImportExecutingBodies, 1);

export const recordProviderImportBodySettled = Metric.modify(providerImportExecutingBodies, -1);

export const recordProviderImportBodyOutcome = (input: {
	readonly outcome: ProviderImportOutcome;
	readonly failureStage: "none" | ProviderImportPhase;
}) =>
	Metric.update(
		Metric.withAttributes(providerImportBodyOutcomes, {
			outcome: input.outcome,
			failure_stage: input.failureStage,
		}),
		1,
	);

export const recordProviderImportPhaseAttempt = (input: {
	readonly startedAtMs: number;
	readonly finishedAtMs: number;
	readonly phase: ProviderImportPhase;
	readonly outcome: ProviderImportAttemptOutcome;
}) =>
	Metric.update(
		Metric.withAttributes(providerImportPhaseAttemptDuration, {
			phase: input.phase,
			outcome: input.outcome,
		}),
		Math.max(0, input.finishedAtMs - input.startedAtMs),
	);
