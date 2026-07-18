import type { SandboxRunError } from "@ryot/contract/errors";
import { badRequest } from "@ryot/contract/errors";
import { AutomationRuleMetadata } from "@ryot/contract/modules/automations/schemas";
import type { SandboxExecutionPayload } from "@ryot/contract/modules/sandbox/schemas";
import {
	AutomationRuleId,
	SandboxScriptId,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { Context, Effect, Layer, Schema } from "effect";
import type { PersistedQueue } from "effect/unstable/persistence";
import { Activity } from "effect/unstable/workflow";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { processSandboxExecutionQueue } from "#modules/sandbox/durable-queues";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";

import { AutomationsService } from "./service";
import {
	SubscriptionExecutionWorkflow,
	SubscriptionExecutionWorkflowError,
	type SubscriptionExecutionWorkflowPayload,
} from "./subscription-execution-workflow";

const PreparedSubscriptionRun = Schema.Struct({
	ruleId: AutomationRuleId,
	runId: SubscriptionRunId,
	sandboxScriptId: SandboxScriptId,
	executionUserId: Schema.NullOr(UserId),
	ruleMetadata: Schema.NullOr(AutomationRuleMetadata),
});

type PreparedSubscriptionRun = typeof PreparedSubscriptionRun.Type;

const BeginSubscriptionRunResult = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("ready") }),
	Schema.Struct({ kind: Schema.Literal("terminal") }),
]);

export type SubscriptionExecutionWorkflowOperationsValue = {
	runSandbox: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<
		SandboxExecutionResult,
		SandboxRunError,
		WorkflowEngine | WorkflowInstance | PersistedQueue.PersistedQueueFactory
	>;
};

export class SubscriptionExecutionWorkflowOperations extends Context.Service<
	SubscriptionExecutionWorkflowOperations,
	SubscriptionExecutionWorkflowOperationsValue
>()("SubscriptionExecutionWorkflowOperations") {}

export const SubscriptionExecutionWorkflowOperationsLive = Layer.succeed(
	SubscriptionExecutionWorkflowOperations,
	{
		runSandbox: processSandboxExecutionQueue,
	},
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
				recordId: payload.recordId,
				signalId: payload.signalId,
				operation: payload.operation,
				rowUserId: payload.rowUserId,
				sourceKind: payload.sourceKind,
				occurrenceId: payload.occurrenceId,
			});
			if (!prepared) {
				return null;
			}
			return {
				runId: prepared.run.id,
				ruleId: prepared.execution.ruleId,
				ruleMetadata: prepared.execution.metadata,
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
			...(payload.signalId ? { signalId: payload.signalId } : {}),
			...(payload.recordId ? { recordId: payload.recordId } : {}),
			...(payload.rowUserId ? { rowUserId: payload.rowUserId } : {}),
		});
		if (payload.source.kind !== payload.sourceKind) {
			return yield* badRequest("Automation source kind does not match its context");
		}
		const validReferences =
			payload.sourceKind === "signal"
				? payload.operation === "signal" && payload.signalId !== undefined && !payload.recordId
				: payload.operation !== "signal" && payload.signalId === undefined && !!payload.recordId;
		if (!validReferences) {
			return yield* badRequest(
				"Automation source does not match its operation and record references",
			);
		}
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
			origin: payload.origin,
			source: payload.source,
			ruleId: prepared.ruleId,
			operation: payload.operation,
			occurredAt: payload.occurredAt,
			occurrenceId: payload.occurrenceId,
			...(payload.population ? { population: payload.population } : {}),
			...(prepared.ruleMetadata === null ? {} : { ruleMetadata: prepared.ruleMetadata }),
		};
		const context = { automation } satisfies AutomationInput;
		const authority: SandboxExecutionPayload["authority"] = prepared.executionUserId
			? {
					type: "subscription",
					userId: prepared.executionUserId,
					subscriptionRun: {
						id: prepared.runId,
						origin: payload.origin,
						occurredAt: payload.occurredAt,
					},
				}
			: { type: "system" };
		const result = yield* operations.runSandbox({
			context,
			authority,
			scriptId: prepared.sandboxScriptId,
			executionId: `${prepared.runId}-sandbox`,
		});

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
