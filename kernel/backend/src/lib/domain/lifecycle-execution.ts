import type { DbError } from "@ryot-app/contract/errors";
import type {
	AutomationPolicyOutput,
	AutomationRequestPayload,
	AutomationRun,
	AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationRunId, type AutomationTriggerId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect, Schema } from "effect";

export class AutomationPolicyExecutionError extends Schema.TaggedError<AutomationPolicyExecutionError>()(
	"AutomationPolicyExecutionError",
	{ runId: AutomationRunId, code: Schema.Literal("policy-execution-failed") },
) {}

export class LifecycleExecution extends Context.Service<
	LifecycleExecution,
	{
		executePolicy: (input: {
			runId: AutomationRunId;
			payload: AutomationRequestPayload;
		}) => Effect.Effect<AutomationPolicyOutput, AutomationPolicyExecutionError>;
		skipQueuedPolicies: (input: { triggerId: AutomationTriggerId }) => Effect.Effect<void, DbError>;
		after: (input: {
			triggerId: AutomationTriggerId;
			runs: ReadonlyArray<AutomationRun>;
		}) => Effect.Effect<ReadonlyArray<AutomationWarning>, DbError>;
	}
>()("LifecycleExecution") {}
