import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import {
	AutomationRuleId,
	EntityId,
	SandboxScriptId,
	SignalId,
	SignalSchemaSlug,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";
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
	signalId,
	id: runId,
	logs: null,
	timing: null,
	recordId: null,
	startedAt: null,
	skipReason: null,
	status: "queued",
	finishedAt: null,
	sandboxError: null,
	returnedValue: null,
	ruleName: rule.name,
	operation: "signal",
	sourceKind: "signal",
	scriptUpdatedAt: null,
	occurrenceId: signalId,
	executionUserId: userId,
	sandboxScriptId: scriptId,
	ruleMetadata: rule.metadata,
	queuedAt: "2026-07-20T10:00:00.000Z",
} satisfies StoredSubscriptionRun;

const payload = {
	ruleId,
	signalId,
	rowUserId: userId,
	operation: "signal",
	sourceKind: "signal",
	occurrenceId: signalId,
	occurredAt: "2026-07-20T10:00:00.000Z",
	origin: { kind: "api" },
	source: {
		kind: "signal",
		signal: {
			id: signalId,
			origin: { kind: "api" },
			properties: { message: "trace" },
			occurredAt: "2026-07-20T10:00:00.000Z",
			signalSchemaSlug: "review.created",
		},
	},
} as const satisfies SubscriptionExecutionWorkflowPayload;

const withWorkflowLayer = <A, E>(
	service: Layer.Layer<AutomationsService>,
	operations: Layer.Layer<SubscriptionExecutionWorkflowOperations>,
	effect: Effect.Effect<
		A,
		E,
		AutomationsService | WorkflowEngine | WorkflowInstance | SubscriptionExecutionWorkflowOperations
	>,
) => {
	const instance = WorkflowInstance.initial(SubscriptionExecutionWorkflow, "workflow-1");
	return effect.pipe(
		Effect.provide(
			Layer.mergeAll(
				service,
				operations,
				Layer.succeed(WorkflowInstance, instance),
				Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			),
		),
	);
};

it.effect("runs a signal subscription to completion with full automation context", () => {
	let completed: unknown;
	let sandboxPayload: unknown;
	const service = Layer.mock(AutomationsService, {
		_tag: "AutomationsService",
		prepareRun: () =>
			Effect.succeed({
				run: queuedRun,
				execution: { ruleId, metadata: rule.metadata, sandboxScriptId: scriptId },
			}),
		beginRun: () => Effect.succeed({ kind: "ready" as const, run: queuedRun }),
		completeRun: (input) => {
			completed = input;
			return Effect.succeed({ ...queuedRun, status: "succeeded" as const });
		},
	});
	const operations = Layer.mock(SubscriptionExecutionWorkflowOperations, {
		runSandbox: (input) => {
			sandboxPayload = input;
			return Effect.succeed({
				error: null,
				logs: ["traced"],
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
			expect(sandboxPayload).toMatchObject({
				userId,
				scriptId,
				driverName: "automation",
				subscriptionRun: { id: runId, origin: payload.origin, occurredAt: payload.occurredAt },
				context: {
					automation: {
						ruleId,
						source: payload.source,
						occurrenceId: signalId,
						occurredAt: payload.occurredAt,
						ruleMetadata: { mode: "trace" },
					},
				},
			});
			expect(completed).toMatchObject({
				id: runId,
				error: null,
				logs: ["traced"],
				value: { ok: true },
				timing: { totalMs: 5, executionMs: 3 },
			});
		}),
	);
});

it.effect("does not execute the sandbox for an already terminal run", () => {
	const service = Layer.mock(AutomationsService, {
		_tag: "AutomationsService",
		prepareRun: () =>
			Effect.succeed({
				run: queuedRun,
				execution: { ruleId, metadata: rule.metadata, sandboxScriptId: scriptId },
			}),
		beginRun: () =>
			Effect.succeed({
				kind: "terminal" as const,
				run: { ...queuedRun, status: "skipped" as const, skipReason: { kind: "user_disabled" } },
			}),
		completeRun: () => Effect.die("terminal run was completed again"),
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

it.effect("rejects contradictory source context before preparing a run", () => {
	const service = Layer.mock(AutomationsService, {
		_tag: "AutomationsService",
		prepareRun: () => Effect.die("invalid context prepared a run"),
	});
	const operations = Layer.mock(SubscriptionExecutionWorkflowOperations, {
		runSandbox: () => Effect.die("invalid context executed the sandbox"),
	});
	const invalid = {
		...payload,
		source: {
			kind: "entity" as const,
			after: {
				name: "Entity",
				properties: {},
				entitySchemaSlug: "movie",
				id: EntityId.make("entity-1"),
			},
		},
	};

	return withWorkflowLayer(
		service,
		operations,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runSubscriptionExecutionWorkflow(invalid, "execution-1"));
			expect(Exit.isFailure(exit)).toBe(true);
		}),
	);
});
