import { Activity } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { SandboxRunError } from "@ryot/contract/errors";
import { badRequest } from "@ryot/contract/errors";
import { AutomationRuleMetadata } from "@ryot/contract/modules/automations/schemas";
import type {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import {
	AutomationRuleId,
	SandboxScriptId,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { Context, Effect, Layer, Schema } from "effect";

import { RunSandboxWorkflow } from "#modules/sandbox/sandbox-run-workflow";

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

const BeginSubscriptionRunResult = Schema.Union(
	Schema.Struct({ kind: Schema.Literal("ready") }),
	Schema.Struct({ kind: Schema.Literal("terminal") }),
);

export type SubscriptionExecutionWorkflowOperationsValue = {
	runSandbox: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<SandboxCompletedResult, SandboxRunError, WorkflowEngine>;
};

export class SubscriptionExecutionWorkflowOperations extends Context.Tag(
	"SubscriptionExecutionWorkflowOperations",
)<SubscriptionExecutionWorkflowOperations, SubscriptionExecutionWorkflowOperationsValue>() {}

export const SubscriptionExecutionWorkflowOperationsLive = Layer.succeed(
	SubscriptionExecutionWorkflowOperations,
	{
		runSandbox: (payload) =>
			Effect.gen(function* () {
				const engine = yield* WorkflowEngine;
				return yield* engine.execute(RunSandboxWorkflow, {
					payload,
					executionId: payload.executionId,
				});
			}),
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
			return prepared
				? {
						runId: prepared.run.id,
						ruleId: prepared.execution.ruleId,
						ruleMetadata: prepared.execution.metadata,
						executionUserId: prepared.run.executionUserId,
						sandboxScriptId: prepared.execution.sandboxScriptId,
					}
				: null;
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
	result: SandboxCompletedResult,
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

export const runSubscriptionExecutionWorkflow = Effect.fn("runSubscriptionExecutionWorkflow")(
	function* (payload: SubscriptionExecutionWorkflowPayload) {
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
			occurrenceId: payload.occurrenceId,
			...(payload.population ? { population: payload.population } : {}),
			...(prepared.ruleMetadata === null ? {} : { ruleMetadata: prepared.ruleMetadata }),
		};
		const context = { automation } satisfies AutomationInput;
		const result = yield* operations.runSandbox({
			context,
			driverName: "automation",
			userId: prepared.executionUserId,
			scriptId: prepared.sandboxScriptId,
			executionId: `${prepared.runId}-sandbox`,
		});

		yield* recordRunOutcome(prepared.runId, result);
		return prepared.runId;
	},
);

const SubscriptionExecutionWorkflowLive = SubscriptionExecutionWorkflow.toLayer((payload) =>
	runSubscriptionExecutionWorkflow(payload),
);

export const SubscriptionExecutionWorkflowDefinitionsLive = Layer.mergeAll(
	SubscriptionExecutionWorkflowLive,
);
