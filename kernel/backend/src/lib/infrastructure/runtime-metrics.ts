import { sandboxHostContracts } from "@ryot-app/sandbox-sdk/core";
import { Effect, Metric } from "effect";

import type { SidecarTier } from "./sandbox-runtime/sidecar-protocol";

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

const RESPONSE_SIZE_BOUNDARIES = [
	1_024, 8_192, 65_536, 262_144, 1_048_576, 4_194_304, 10_485_760,
] as const;

const JOURNAL_SIZE_BOUNDARIES = [
	1_024, 8_192, 65_536, 524_288, 1_048_576, 10_485_760, 104_857_600,
] as const;

const JOURNAL_ENTRY_BOUNDARIES = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000] as const;

export const SANDBOX_METRIC_KINDS = [
	"script",
	"operation",
	"workflow",
	"provider",
	"automation",
	"unknown",
] as const;

export type SandboxMetricKind = (typeof SANDBOX_METRIC_KINDS)[number];

export type ProviderImportOutcome = "success" | "failure";
export type SandboxHostCallOutcome = "success" | "failure";
export type SandboxExecutionOutcome = "success" | "failure" | "timeout";
export type ProviderImportPhase = "population" | "provider-import-automation";
/** A body attempt interrupted by workflow suspension is neither a success nor a failure. */
export type ProviderImportAttemptOutcome = ProviderImportOutcome | "interrupted";
export type SandboxReplayOutcome = "completed" | "failed" | "missing" | "pending";

export const sandboxMetricKind = (metadata: unknown): SandboxMetricKind => {
	const kind =
		typeof metadata === "object" && metadata !== null && "kind" in metadata
			? metadata.kind
			: undefined;
	return SANDBOX_METRIC_KINDS.find((candidate) => candidate === kind) ?? "unknown";
};

const hostFunctionNames: ReadonlySet<string> = new Set([
	...Object.keys(sandboxHostContracts),
	"artifactReadRange",
	"inlineBatch",
	"journalRead",
	"replayJournal",
	"scratchWrite",
]);

export const sandboxMetricHostFunction = (name: string) =>
	hostFunctionNames.has(name) ? name : "unknown";

const sandboxExecutions = Metric.counter("ryot.sandbox.executions", {
	incremental: true,
	attributes: { unit: "{execution}" },
	description: "Sandbox executions by terminal outcome",
});

const sandboxActiveExecutions = Metric.gauge("ryot.sandbox.active_executions", {
	attributes: { unit: "{execution}" },
	description: "Sandbox executions currently running",
});

const backendRss = Metric.gauge("ryot.backend.rss", {
	attributes: { unit: BYTES },
	description: "Resident set size of the backend process",
});

const backendHeapUsed = Metric.gauge("ryot.backend.heap_used", {
	attributes: { unit: BYTES },
	description: "Used JavaScript heap of the backend process",
});

const backendExternalMemory = Metric.gauge("ryot.backend.external_memory", {
	attributes: { unit: BYTES },
	description: "External memory of the backend process",
});

const sandboxExecutionDuration = Metric.histogram("ryot.sandbox.execution_duration", {
	attributes: { unit: MILLISECONDS },
	boundaries: [...DURATION_BOUNDARIES],
	description: "Wall-clock duration of a sandbox execution",
});

const sandboxRunnerResponseSize = Metric.histogram("ryot.sandbox.runner_response_size", {
	attributes: { unit: BYTES },
	boundaries: [...RESPONSE_SIZE_BOUNDARIES],
	description: "Serialized size of the response line returned by a sandbox worker",
});

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

const sandboxHostCalls = Metric.counter("ryot.sandbox.host_calls", {
	incremental: true,
	attributes: { unit: "{call}" },
	description: "Sandbox host-function calls by function and outcome",
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

export const recordSandboxExecution = (input: {
	readonly durationMs: number;
	readonly responseBytes: number;
	readonly kind: SandboxMetricKind;
	readonly outcome: SandboxExecutionOutcome;
}) => {
	const attributes = { kind: input.kind, outcome: input.outcome };
	return Effect.all(
		[
			Metric.update(Metric.withAttributes(sandboxExecutions, attributes), 1),
			Metric.update(Metric.withAttributes(sandboxExecutionDuration, attributes), input.durationMs),
			Metric.update(
				Metric.withAttributes(sandboxRunnerResponseSize, attributes),
				input.responseBytes,
			),
		],
		{ discard: true },
	);
};

export const recordSandboxSidecarEvent = (input: {
	readonly trust: "system" | "user";
	readonly tier: typeof SidecarTier.Type;
	readonly event:
		| "start"
		| "stop"
		| "ready"
		| "released"
		| "restart"
		| "probe"
		| "collateral"
		| "quarantine"
		| "probation"
		| "limit"
		| "disposal";
	readonly reason: string;
	readonly durationMs?: number;
}) =>
	Effect.all(
		[
			Metric.update(
				Metric.withAttributes(
					Metric.counter("ryot.sandbox.sidecar.events", {
						incremental: true,
						attributes: { unit: "{event}" },
					}),
					{ trust: input.trust, event: input.event, snapshot: input.tier, reason: input.reason },
				),
				1,
			),
			...(input.event === "start" || input.event === "stop"
				? [
						Metric.update(
							Metric.withAttributes(
								Metric.gauge("ryot.sandbox.sidecar.live_processes", {
									attributes: { unit: "{process}" },
								}),
								{ trust: input.trust, snapshot: input.tier },
							),
							input.event === "start" ? 1 : 0,
						),
					]
				: []),
			...(input.durationMs === undefined
				? []
				: [
						Metric.update(
							Metric.withAttributes(
								Metric.histogram("ryot.sandbox.sidecar.duration", {
									attributes: { unit: MILLISECONDS },
									boundaries: [...DURATION_BOUNDARIES],
								}),
								{
									trust: input.trust,
									event: input.event,
									snapshot: input.tier,
									reason: input.reason,
								},
							),
							input.durationMs,
						),
					]),
		],
		{ discard: true },
	);

export const recordSandboxSidecarGauges = (input: {
	readonly trust: "system" | "user";
	readonly tier: typeof SidecarTier.Type;
	readonly runs: number;
	readonly hostCalls: number;
	readonly backoffMs: number;
}) =>
	Effect.forEach(
		[
			["outstanding_runs", input.runs],
			["outstanding_host_calls", input.hostCalls],
			["restart_backoff", input.backoffMs],
		] as const,
		([name, value]) =>
			Metric.update(
				Metric.withAttributes(
					Metric.gauge(`ryot.sandbox.sidecar.${name}`, {
						attributes: { unit: name === "restart_backoff" ? MILLISECONDS : "{item}" },
					}),
					{ trust: input.trust, snapshot: input.tier },
				),
				value,
			),
		{ discard: true },
	);

export const recordSandboxAdmission = (input: {
	readonly waiting: number;
	readonly bytes: number;
	readonly budget: number;
}) =>
	Effect.all(
		[
			Metric.update(
				Metric.gauge("ryot.sandbox.admission.waiting", { attributes: { unit: "{run}" } }),
				input.waiting,
			),
			Metric.update(
				Metric.gauge("ryot.sandbox.admission.bytes", { attributes: { unit: BYTES } }),
				input.bytes,
			),
			Metric.update(
				Metric.gauge("ryot.sandbox.admission.pressure", { attributes: { unit: "1" } }),
				input.bytes / input.budget,
			),
		],
		{ discard: true },
	);

export const recordSandboxAdmissionWait = (durationMs: number) =>
	Metric.update(
		Metric.histogram("ryot.sandbox.admission.wait_duration", {
			attributes: { unit: MILLISECONDS },
			boundaries: [...DURATION_BOUNDARIES],
		}),
		durationMs,
	);

export const recordSandboxHostCall = (input: {
	readonly function: string;
	readonly outcome: SandboxHostCallOutcome;
}) =>
	Metric.update(
		Metric.withAttributes(sandboxHostCalls, {
			outcome: input.outcome,
			function: sandboxMetricHostFunction(input.function),
		}),
		1,
	);

export const recordSandboxSidecarHostCall = (input: {
	readonly trust: "system" | "user";
	readonly tier: typeof SidecarTier.Type;
	readonly function: string;
	readonly outcome: "success" | "failure" | "interrupted";
}) =>
	Metric.update(
		Metric.withAttributes(
			Metric.counter("ryot.sandbox.sidecar.host_calls", {
				incremental: true,
				attributes: { unit: "{call}" },
			}),
			{
				trust: input.trust,
				snapshot: input.tier,
				outcome: input.outcome,
				function: sandboxMetricHostFunction(input.function),
			},
		),
		1,
	);

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
			Metric.update(Metric.withAttributes(sandboxWorkflowReplays, attributes), 1),
			Metric.update(
				Metric.withAttributes(sandboxWorkflowReplayDuration, attributes),
				input.durationMs,
			),
			Metric.update(
				Metric.withAttributes(sandboxWorkflowJournalSize, { kind: input.kind }),
				input.journalBytes,
			),
			Metric.update(
				Metric.withAttributes(sandboxWorkflowJournalEntries, { kind: input.kind }),
				input.journalEntries,
			),
		],
		{ discard: true },
	);
};

export const recordSandboxRuntimeGauges = (input: {
	readonly heapUsedBytes: number;
	readonly backendRssBytes: number;
	readonly externalMemoryBytes: number;
}) =>
	Effect.all(
		[
			Metric.update(backendRss, input.backendRssBytes),
			Metric.update(backendHeapUsed, input.heapUsedBytes),
			Metric.update(backendExternalMemory, input.externalMemoryBytes),
		],
		{ discard: true },
	);

export const recordSandboxActiveExecutions = (value: number) =>
	Metric.update(sandboxActiveExecutions, value);

export const recordSandboxAggregateRss = (bytes: number, sampledProcesses: number) =>
	Effect.all(
		[
			Metric.update(
				Metric.gauge("ryot.sandbox.worker_rss", { attributes: { unit: BYTES } }),
				bytes,
			),
			Metric.update(
				Metric.gauge("ryot.sandbox.rss_sampled_processes", { attributes: { unit: "{process}" } }),
				sampledProcesses,
			),
		],
		{ discard: true },
	);

export const recordSandboxSidecarRss = (input: {
	readonly trust: "system" | "user";
	readonly tier: typeof SidecarTier.Type;
	readonly bytes: number;
}) =>
	Metric.update(
		Metric.withAttributes(
			Metric.gauge("ryot.sandbox.sidecar.rss", { attributes: { unit: BYTES } }),
			{ trust: input.trust, snapshot: input.tier },
		),
		input.bytes,
	);

let executingProviderImportBodies = 0;

const setProviderImportExecutingBodies = (delta: number) =>
	Effect.suspend(() => {
		executingProviderImportBodies = Math.max(0, executingProviderImportBodies + delta);
		return Metric.update(providerImportExecutingBodies, executingProviderImportBodies);
	});

export const recordProviderImportBodyStarted = setProviderImportExecutingBodies(1);

export const recordProviderImportBodySettled = setProviderImportExecutingBodies(-1);

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
