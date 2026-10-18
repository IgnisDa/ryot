import type { DbError } from "@ryot-app/contract/errors";
import type {
	AutomationEntityDraft,
	AutomationPolicyBatchOutput,
	AutomationPolicyOutput,
	AutomationPolicyPatch,
	AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationRunId, type AutomationTriggerId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect, Schema } from "effect";

import type {
	LifecycleDispatchPlan,
	LifecycleDispatchRun,
	LifecyclePersistenceError,
} from "./planning";

export class AutomationPolicyExecutionError extends Schema.TaggedError<
	AutomationPolicyExecutionError,
	{ readonly brand: unique symbol }
>()("AutomationPolicyExecutionError", {
	runId: AutomationRunId,
	code: Schema.Literal("policy-execution-failed"),
}) {}

export class LifecycleExecution extends Context.Service<
	LifecycleExecution,
	{
		skipQueuedPolicies: (input: { triggerId: AutomationTriggerId }) => Effect.Effect<void, DbError>;
		dispatch: (
			plans: ReadonlyArray<LifecycleDispatchPlan>,
		) => Effect.Effect<ReadonlyArray<AutomationWarning>, DbError | LifecyclePersistenceError>;
		after: (input: {
			triggerId: AutomationTriggerId;
			runs: ReadonlyArray<LifecycleDispatchRun>;
		}) => Effect.Effect<ReadonlyArray<AutomationWarning>, DbError>;
		executePolicy: (input: {
			runId: AutomationRunId;
			acceptedPatches: ReadonlyArray<AutomationPolicyPatch>;
		}) => Effect.Effect<AutomationPolicyOutput, AutomationPolicyExecutionError>;
		executeBatchPolicy: (input: {
			runId: AutomationRunId;
			activeItemIdentities: ReadonlyArray<string>;
			acceptedReferences: Readonly<Record<string, AutomationEntityDraft>>;
			acceptedBatchPatches: Readonly<Record<string, ReadonlyArray<AutomationPolicyPatch>>>;
		}) => Effect.Effect<AutomationPolicyBatchOutput, AutomationPolicyExecutionError>;
	}
>()("LifecycleExecution") {}
