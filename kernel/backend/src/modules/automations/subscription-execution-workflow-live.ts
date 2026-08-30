import type { SandboxRunError } from "@ryot-app/contract/errors";
import { badRequest } from "@ryot-app/contract/errors";
import {
	AutomationOperation,
	AutomationOrigin,
} from "@ryot-app/contract/modules/automations/schemas";
import type { AutomationOccurrenceSource } from "@ryot-app/contract/modules/automations/schemas";
import type { SandboxExecutionPayload } from "@ryot-app/contract/modules/sandbox/schemas";
import {
	AutomationRuleId,
	AutomationOccurrenceId,
	EntityId,
	EventId,
	RelationshipId,
	SandboxScriptId,
	SubscriptionRunId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { Context, Effect, Layer, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";

import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { AutomationsService } from "./service";
import {
	SubscriptionExecutionWorkflow,
	SubscriptionExecutionWorkflowError,
	type SubscriptionExecutionWorkflowPayload,
} from "./subscription-execution-workflow";

const PreparedSubscriptionRun = Schema.Struct({
	ruleId: AutomationRuleId,
	runId: SubscriptionRunId,
	origin: AutomationOrigin,
	occurredAt: Schema.String,
	operation: AutomationOperation,
	sandboxScriptId: SandboxScriptId,
	executionUserId: Schema.NullOr(UserId),
	source: Schema.Union([
		Schema.Struct({ entityId: EntityId, kind: Schema.Literal("entity") }),
		Schema.Struct({ eventId: EventId, kind: Schema.Literal("event") }),
		Schema.Struct({ relationshipId: RelationshipId, kind: Schema.Literal("relationship") }),
		Schema.Struct({ signalId: Schema.String, kind: Schema.Literal("signal") }),
	]),
});

type PreparedSubscriptionRun = typeof PreparedSubscriptionRun.Type;

const sourceReference = (source: AutomationOccurrenceSource) =>
	Effect.gen(function* () {
		if (source.kind === "signal") {
			return { kind: "signal" as const, signalId: source.signal.id };
		}
		if (source.kind === "provider-entity-import") {
			return yield* badRequest("Provider imports are not subscription occurrences");
		}
		if (source.kind === "entity") {
			const snapshot = source.after ?? source.before;
			if (!snapshot) {
				return yield* badRequest("Automation occurrence requires a before or after snapshot");
			}
			return { entityId: snapshot.id, kind: "entity" as const };
		}
		if (source.kind === "event") {
			const snapshot = source.after ?? source.before;
			if (!snapshot) {
				return yield* badRequest("Automation occurrence requires a before or after snapshot");
			}
			return { eventId: snapshot.id, kind: "event" as const };
		}
		const snapshot = source.after ?? source.before;
		if (!snapshot) {
			return yield* badRequest("Automation occurrence requires a before or after snapshot");
		}
		return { relationshipId: snapshot.id, kind: "relationship" as const };
	});

const BeginSubscriptionRunResult = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("ready") }),
	Schema.Struct({ kind: Schema.Literal("terminal") }),
]);

export type SubscriptionExecutionWorkflowOperationsValue = {
	runSandbox: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<SandboxExecutionResult, SandboxRunError>;
};

export class SubscriptionExecutionWorkflowOperations extends Context.Service<
	SubscriptionExecutionWorkflowOperations,
	SubscriptionExecutionWorkflowOperationsValue
>()("SubscriptionExecutionWorkflowOperations") {}

export const SubscriptionExecutionWorkflowOperationsLive = Layer.effect(
	SubscriptionExecutionWorkflowOperations,
	Effect.gen(function* () {
		const sandbox = yield* SandboxExecutionService;
		return {
			runSandbox: (payload: SandboxExecutionPayload) =>
				sandbox.executeScript({
					input: payload.context,
					subject: payload.subject,
					scriptId: payload.scriptId,
					executionId: payload.executionId,
				}),
		} satisfies SubscriptionExecutionWorkflowOperationsValue;
	}),
);

const prepareRun = Effect.fn("prepareSubscriptionRun")(function* (
	payload: SubscriptionExecutionWorkflowPayload,
) {
	const service = yield* AutomationsService;
	return yield* Activity.make({
		name: "prepare-subscription-run",
		error: SubscriptionExecutionWorkflowError,
		success: Schema.NullOr(PreparedSubscriptionRun),
		execute: Effect.gen(function* () {
			const prepared = yield* service.prepareRun({
				ruleId: payload.ruleId,
				rowUserId: payload.rowUserId,
				occurrenceId: payload.occurrenceId,
			});
			if (!prepared) {
				return null;
			}
			const reference = yield* sourceReference(prepared.occurrence.source);
			return {
				source: reference,
				runId: prepared.run.id,
				ruleId: prepared.execution.ruleId,
				origin: prepared.occurrence.origin,
				operation: prepared.occurrence.operation,
				occurredAt: prepared.occurrence.occurredAt,
				executionUserId: prepared.run.executionUserId,
				sandboxScriptId: prepared.execution.sandboxScriptId,
			};
		}),
	});
});

const beginRun = Effect.fn("beginSubscriptionRun")(function* (prepared: PreparedSubscriptionRun) {
	const service = yield* AutomationsService;
	return yield* Activity.make({
		name: "begin-subscription-run",
		success: BeginSubscriptionRunResult,
		error: SubscriptionExecutionWorkflowError,
		execute: service
			.beginRun({ id: prepared.runId, sandboxScriptId: prepared.sandboxScriptId })
			.pipe(Effect.map(({ kind }) => ({ kind }))),
	});
});

const recordRunOutcome = Effect.fn("recordSubscriptionRunOutcome")(function* (
	runId: SubscriptionRunId,
	result: SandboxExecutionResult,
) {
	const service = yield* AutomationsService;
	return yield* Activity.make({
		success: SubscriptionRunId,
		name: "record-subscription-run-outcome",
		error: SubscriptionExecutionWorkflowError,
		execute: service
			.completeRun({
				id: runId,
				logs: result.logs,
				error: result.error,
				value: result.value,
				timing: result.timing,
			})
			.pipe(Effect.map((run) => run.id)),
	});
});

export const runSubscriptionExecutionWorkflow = Effect.fn("SubscriptionExecutionWorkflow")(
	function* (payload: SubscriptionExecutionWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			ruleId: payload.ruleId,
			occurrenceId: payload.occurrenceId,
			...(payload.rowUserId ? { rowUserId: payload.rowUserId } : {}),
		});
		const prepared = yield* prepareRun(payload);
		if (!prepared) {
			return null;
		}

		const started = yield* beginRun(prepared);
		if (started.kind === "terminal") {
			return prepared.runId;
		}

		const operations = yield* SubscriptionExecutionWorkflowOperations;
		const automation = {
			runId: prepared.runId,
			origin: prepared.origin,
			source: prepared.source,
			ruleId: prepared.ruleId,
			operation: prepared.operation,
			occurredAt: prepared.occurredAt,
			occurrenceId: payload.occurrenceId,
		};
		const context = { automation } satisfies AutomationInput;
		const subject: SandboxExecutionPayload["subject"] = prepared.executionUserId
			? {
					type: "subscription",
					userId: prepared.executionUserId,
					subscriptionRun: {
						id: prepared.runId,
						origin: prepared.origin,
						occurredAt: prepared.occurredAt,
						occurrenceId: AutomationOccurrenceId.make(payload.occurrenceId),
					},
				}
			: {
					type: "system",
					automationRunId: prepared.runId,
					automationOccurrenceId: AutomationOccurrenceId.make(payload.occurrenceId),
				};
		const result = yield* operations
			.runSandbox({
				context,
				subject,
				scriptId: prepared.sandboxScriptId,
				executionId: `${prepared.runId}-sandbox`,
			})
			.pipe(
				Effect.catchTag("SandboxRunError", (error) =>
					Effect.succeed({
						logs: [],
						value: null,
						status: "completed" as const,
						error: { message: error.message, phase: "execute" as const },
					}),
				),
			);

		yield* recordRunOutcome(prepared.runId, result);
		return prepared.runId;
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "SubscriptionExecutionWorkflow" }),
);

const SubscriptionExecutionWorkflowLive = SubscriptionExecutionWorkflow.toLayer(
	runSubscriptionExecutionWorkflow,
);

export const SubscriptionExecutionWorkflowDefinitionsLive = Layer.mergeAll(
	SubscriptionExecutionWorkflowLive,
);
