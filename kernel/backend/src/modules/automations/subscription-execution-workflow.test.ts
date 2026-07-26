import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import type { AutomationOccurrence } from "@ryot-app/contract/modules/automations/schemas";
import {
	AutomationOccurrenceId,
	AutomationRuleId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	SandboxScriptId,
	SignalId,
	SignalSchemaSlug,
	SubscriptionRunId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Layer } from "effect";
import { PersistedQueue } from "effect/unstable/persistence";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import type { Database } from "#lib/infrastructure/db/service";
import { databaseLayer, makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import type { ResolvedAutomationRule } from "#modules/plugins/runtime-resolver";

import type { StoredSubscriptionRun } from "./repository";
import { AutomationsService } from "./service";
import {
	SubscriptionExecutionWorkflow,
	type SubscriptionExecutionWorkflowPayload,
} from "./subscription-execution-workflow";
import {
	runSubscriptionExecutionWorkflow,
	SubscriptionExecutionWorkflowOperations,
} from "./subscription-execution-workflow-live";

const userId = UserId.make("user-1");
const signalId = SignalId.make("signal-1");
const occurrenceId = AutomationOccurrenceId.make("signal-occurrence-1");
const eventOccurrenceId = AutomationOccurrenceId.make("event-occurrence-1");
const runId = SubscriptionRunId.make("run-1");
const ruleId = AutomationRuleId.make("rule-1");
const scriptId = SandboxScriptId.make("script-1");

const rule = {
	userId,
	id: ruleId,
	position: null,
	isActive: true,
	isBuiltin: false,
	operation: "signal",
	kind: "subscription",
	sandboxScriptId: scriptId,
	metadata: { mode: "trace" },
	name: "Tracer subscription",
	target: { kind: "signal_schema", id: SignalSchemaSlug.make("signal-schema-1") },
} satisfies ResolvedAutomationRule;

const queuedRun = {
	ruleId,
	id: runId,
	logs: null,
	timing: null,
	occurrenceId,
	startedAt: null,
	skipReason: null,
	status: "queued",
	finishedAt: null,
	sandboxError: null,
	returnedValue: null,
	ruleName: rule.name,
	scriptUpdatedAt: null,
	executionUserId: userId,
	sandboxScriptId: scriptId,
	ruleMetadata: rule.metadata,
	queuedAt: "2026-07-20T10:00:00.000Z",
} satisfies StoredSubscriptionRun;

const payload = {
	ruleId,
	occurrenceId,
	rowUserId: userId,
} as const satisfies SubscriptionExecutionWorkflowPayload;

const largeSourceProperty = "source-only".repeat(10_000);
const signalOccurrence = {
	userId,
	signalId,
	recordId: null,
	id: occurrenceId,
	population: null,
	operation: "signal",
	sourceKind: "signal",
	origin: { kind: "api" },
	occurredAt: "2026-07-20T10:00:00.000Z",
	source: {
		kind: "signal",
		signal: {
			id: signalId,
			origin: { kind: "api" },
			properties: { largeSourceProperty },
			occurredAt: "2026-07-20T10:00:00.000Z",
			signalSchemaSlug: SignalSchemaSlug.make("review.created"),
		},
	},
} as const satisfies AutomationOccurrence;

const eventPayload = {
	ruleId,
	rowUserId: userId,
	occurrenceId: eventOccurrenceId,
} as const satisfies SubscriptionExecutionWorkflowPayload;

const eventOccurrence = {
	userId,
	signalId: null,
	population: null,
	operation: "create",
	sourceKind: "event",
	id: eventOccurrenceId,
	origin: { kind: "api" },
	recordId: EventId.make("event-1"),
	occurredAt: "2026-07-20T11:00:00.000Z",
	source: {
		kind: "event",
		after: {
			properties: {},
			id: EventId.make("event-1"),
			createdAt: "2026-07-20T12:00:00.000Z",
			occurredAt: "2026-07-20T11:00:00.000Z",
			sessionEntityId: EntityId.make("session-1"),
			eventSchemaSlug: EventSchemaSlug.make("complete"),
			subject: {
				name: "Dune",
				id: EntityId.make("entity-1"),
				entitySchemaSlug: EntitySchemaSlug.make("record"),
			},
		},
	},
} as const satisfies AutomationOccurrence;

const withWorkflowLayer = <A, E>(
	service: Layer.Layer<AutomationsService>,
	operations: Layer.Layer<SubscriptionExecutionWorkflowOperations>,
	effect: Effect.Effect<
		A,
		E,
		| WorkflowEngine
		| WorkflowInstance
		| AutomationsService
		| Database
		| PersistedQueue.PersistedQueueFactory
		| SubscriptionExecutionWorkflowOperations
	>,
) => {
	const instance = WorkflowInstance.initial(SubscriptionExecutionWorkflow, "workflow-1");
	return effect.pipe(
		Effect.provide(
			Layer.mergeAll(
				databaseLayer,
				service,
				operations,
				Layer.provide(PersistedQueue.layer, PersistedQueue.layerStoreMemory),
				Layer.succeed(WorkflowInstance, instance),
				Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			),
		),
	);
};

it.effect("keeps large occurrence properties out of the subscription sandbox input", () => {
	let completed: unknown;
	let sandboxPayload: unknown;
	const logs = ["console", '{"kind":"log","level":"info","message":"traced"}'];
	const service = Layer.mock(AutomationsService, {
		beginRun: () => Effect.succeed({ run: queuedRun, kind: "ready" as const }),
		completeRun: (input) => {
			completed = input;
			return Effect.succeed({ ...queuedRun, status: "succeeded" as const });
		},
		prepareRun: () =>
			Effect.succeed({
				run: queuedRun,
				occurrence: signalOccurrence,
				execution: { ruleId, metadata: rule.metadata, sandboxScriptId: scriptId },
			}),
	});
	const operations = Layer.mock(SubscriptionExecutionWorkflowOperations, {
		runSandbox: (input) => {
			sandboxPayload = input;
			return Effect.succeed({
				logs,
				error: null,
				value: { ok: true },
				status: "completed" as const,
				timing: { totalMs: 5, executionMs: 3 },
			});
		},
	});

	return withWorkflowLayer(
		service,
		operations,
		Effect.gen(function* () {
			expect(yield* runSubscriptionExecutionWorkflow(payload, "execution-1")).toBe(runId);
			expect(sandboxPayload).toEqual({
				scriptId,
				executionId: `${runId}-sandbox`,
				subject: {
					userId,
					type: "subscription",
					subscriptionRun: {
						id: runId,
						occurrenceId,
						origin: signalOccurrence.origin,
						occurredAt: signalOccurrence.occurredAt,
					},
				},
				context: {
					automation: {
						runId,
						ruleId,
						occurrenceId,
						operation: "signal",
						origin: signalOccurrence.origin,
						source: { signalId, kind: "signal" },
						occurredAt: signalOccurrence.occurredAt,
					},
				},
			});
			expect(stableStringify(sandboxPayload)).not.toContain(largeSourceProperty);
			expect(completed).toMatchObject({
				logs,
				id: runId,
				error: null,
				value: { ok: true },
				timing: { totalMs: 5, executionMs: 3 },
			});
		}),
	);
});

it.effect("passes only an event source reference to the sandbox", () => {
	let sandboxPayload: unknown;
	const eventRun = { ...queuedRun, occurrenceId: eventOccurrence.id };
	const service = Layer.mock(AutomationsService, {
		beginRun: () => Effect.succeed({ run: eventRun, kind: "ready" as const }),
		completeRun: () => Effect.succeed({ ...eventRun, status: "succeeded" as const }),
		prepareRun: () =>
			Effect.succeed({
				run: eventRun,
				occurrence: eventOccurrence,
				execution: { ruleId, metadata: rule.metadata, sandboxScriptId: scriptId },
			}),
	});
	const operations = Layer.mock(SubscriptionExecutionWorkflowOperations, {
		runSandbox: (input) => {
			sandboxPayload = input;
			return Effect.succeed({
				logs: [],
				error: null,
				value: null,
				status: "completed" as const,
				timing: { totalMs: 1, executionMs: 1 },
			});
		},
	});

	return withWorkflowLayer(
		service,
		operations,
		Effect.gen(function* () {
			expect(yield* runSubscriptionExecutionWorkflow(eventPayload, "execution-1")).toBe(runId);
			expect(sandboxPayload).toEqual({
				scriptId,
				executionId: `${runId}-sandbox`,
				subject: {
					userId,
					type: "subscription",
					subscriptionRun: {
						id: runId,
						origin: eventOccurrence.origin,
						occurrenceId: eventOccurrenceId,
						occurredAt: eventOccurrence.occurredAt,
					},
				},
				context: {
					automation: {
						runId,
						ruleId,
						operation: "create",
						origin: eventOccurrence.origin,
						occurrenceId: eventOccurrenceId,
						occurredAt: eventOccurrence.occurredAt,
						source: { kind: "event", eventId: eventOccurrence.recordId },
					},
				},
			});
		}),
	);
});

it.effect("does not execute the sandbox for an already terminal run", () => {
	const service = Layer.mock(AutomationsService, {
		completeRun: () => Effect.die("terminal run was completed again"),
		beginRun: () =>
			Effect.succeed({
				kind: "terminal" as const,
				run: { ...queuedRun, status: "skipped" as const, skipReason: { kind: "user_disabled" } },
			}),
		prepareRun: () =>
			Effect.succeed({
				run: queuedRun,
				occurrence: signalOccurrence,
				execution: { ruleId, metadata: rule.metadata, sandboxScriptId: scriptId },
			}),
	});
	const operations = Layer.mock(SubscriptionExecutionWorkflowOperations, {
		runSandbox: () => Effect.die("terminal run executed the sandbox"),
	});

	return withWorkflowLayer(
		service,
		operations,
		Effect.gen(function* () {
			expect(yield* runSubscriptionExecutionWorkflow(payload, "execution-1")).toBe(runId);
		}),
	);
});

it.effect("records sandbox failures before completing the subscription run", () => {
	let completed: unknown;
	const service = Layer.mock(AutomationsService, {
		beginRun: () => Effect.succeed({ run: queuedRun, kind: "ready" as const }),
		completeRun: (input) => {
			completed = input;
			return Effect.succeed({ ...queuedRun, status: "failed" as const });
		},
		prepareRun: () =>
			Effect.succeed({
				run: queuedRun,
				occurrence: signalOccurrence,
				execution: { ruleId, metadata: rule.metadata, sandboxScriptId: scriptId },
			}),
	});
	const operations = Layer.mock(SubscriptionExecutionWorkflowOperations, {
		runSandbox: () => Effect.fail(new SandboxRunError({ message: "script failed" })),
	});

	return withWorkflowLayer(
		service,
		operations,
		Effect.gen(function* () {
			expect(yield* runSubscriptionExecutionWorkflow(payload, "execution-1")).toBe(runId);
			expect(completed).toMatchObject({
				logs: [],
				id: runId,
				value: null,
				error: { phase: "execute", message: "script failed" },
			});
		}),
	);
});
