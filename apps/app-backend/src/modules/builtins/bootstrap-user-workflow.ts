import { Workflow } from "@effect/workflow";
import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DbError } from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import type { Context } from "effect";
import { Schema } from "effect";

export const BootstrapUserWorkflowError = DbError;

export type BootstrapUserWorkflowError = typeof BootstrapUserWorkflowError.Type;

export const BootstrapUserWorkflowPayload = Schema.Struct({
	userId: UserId,
	executionId: Schema.String,
});

export type BootstrapUserWorkflowPayload = typeof BootstrapUserWorkflowPayload.Type;

export const BootstrapUserWorkflow = Workflow.make({
	success: Schema.Void,
	name: "BootstrapUserWorkflow",
	error: BootstrapUserWorkflowError,
	payload: BootstrapUserWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const executeBootstrapUser = (
	engine: Context.Tag.Service<typeof WorkflowEngine>,
	payload: BootstrapUserWorkflowPayload,
) => engine.execute(BootstrapUserWorkflow, { payload, executionId: payload.executionId });
