import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
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

export type ProviderImportPhase = "population" | "provider-import-automation";

/** A body attempt interrupted by workflow suspension is neither a success nor a failure. */
export type ProviderImportAttemptOutcome = ProviderImportOutcome | "interrupted";

export type SandboxReplayOutcome = "completed" | "failed" | "missing" | "pending";

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

const durableQueueWaitDuration = Metric.histogram("ryot.durable_queue.wait_duration", {
	attributes: { unit: MILLISECONDS },
	boundaries: [...PHASE_DURATION_BOUNDARIES],
	description: "Time a durable queue item waited from offer to its first take, by lane",
});

const durableQueueDispatches = Metric.counter("ryot.durable_queue.dispatches", {
	incremental: true,
	attributes: { unit: "{dispatch}" },
	description: "Durable queue items handed to a worker, by lane",
});

const httpAdmissionTickets = Metric.counter("ryot.http_admission.tickets", {
	incremental: true,
	attributes: { unit: "{ticket}" },
	description:
		"Matched HTTP admission tickets granted, whose grant expired, or refused as overloaded",
});

const httpAdmissionTicketWait = Metric.histogram("ryot.http_admission.ticket_wait", {
	attributes: { unit: MILLISECONDS },
	boundaries: [...PHASE_DURATION_BOUNDARIES],
	description: "Time a matched HTTP admission ticket waited from registration to its grant",
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

export const recordDurableQueueDispatch = (input: {
	readonly lane: ExecutionLane;
	readonly waitMs: number | undefined;
}) => {
	const attributes = { lane: input.lane };
	return Effect.all(
		[
			Metric.update(Metric.withAttributes(durableQueueDispatches, attributes), 1),
			input.waitMs === undefined
				? Effect.void
				: Metric.update(Metric.withAttributes(durableQueueWaitDuration, attributes), input.waitMs),
		],
		{ discard: true },
	);
};

/** Labelled by lane, policy key and outcome only; tickets never carry user, tenant or plugin. */
export const recordHttpAdmissionTicket = (input: {
	readonly lane: ExecutionLane;
	readonly policy: string;
	readonly waitedMs?: number;
	readonly outcome: "granted" | "expired" | "overloaded";
}) => {
	const attributes = { lane: input.lane, policy: input.policy, outcome: input.outcome };
	return Effect.all(
		[
			Metric.update(Metric.withAttributes(httpAdmissionTickets, attributes), 1),
			input.waitedMs === undefined
				? Effect.void
				: Metric.update(
						Metric.withAttributes(httpAdmissionTicketWait, {
							lane: input.lane,
							policy: input.policy,
						}),
						input.waitedMs,
					),
		],
		{ discard: true },
	);
};

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
	readonly failureStage: ProviderImportPhase | "none";
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
