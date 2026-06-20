import { Workflow } from "@effect/workflow";
import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DbError, SandboxRunError } from "@ryot/contract/errors";
import { SubscriptionExecutionPayload } from "@ryot/contract/modules/automations/schemas";
import { SubscriptionRunId } from "@ryot/contract/schema/brands";
import type { Context } from "effect";
import { Schema } from "effect";

export const SubscriptionExecutionResult = Schema.Struct({
	status: Schema.Literal("succeeded", "failed", "skipped"),
});

export const SubscriptionExecutionWorkflow = Workflow.make({
	success: SubscriptionExecutionResult,
	name: "SubscriptionExecutionWorkflow",
	payload: SubscriptionExecutionPayload,
	error: Schema.Union(DbError, SandboxRunError),
	idempotencyKey: ({ executionId }) => executionId,
});

export const executeSubscriptionExecution = (
	engine: Context.Tag.Service<typeof WorkflowEngine>,
	input: Omit<SubscriptionExecutionPayload, "runId">,
) => {
	const runId = new Bun.CryptoHasher("sha256").update(input.executionId).digest("base64url");
	return engine.execute(SubscriptionExecutionWorkflow, {
		discard: true,
		executionId: input.executionId,
		payload: { ...input, runId: SubscriptionRunId.make(runId) },
	});
};
