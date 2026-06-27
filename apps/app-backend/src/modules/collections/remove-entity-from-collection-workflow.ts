import { Workflow } from "@effect/workflow";
import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
import { MembershipResponse } from "@ryot/contract/modules/collections/schemas";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
import type { Context } from "effect";
import { Schema } from "effect";

export const RemoveEntityFromCollectionWorkflowError = Schema.Union(BadRequest, DbError, NotFound);

export type RemoveEntityFromCollectionWorkflowError =
	typeof RemoveEntityFromCollectionWorkflowError.Type;

export const RemoveEntityFromCollectionWorkflowPayload = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	collectionId: EntityId,
	executionId: Schema.String,
});

export type RemoveEntityFromCollectionWorkflowPayload =
	typeof RemoveEntityFromCollectionWorkflowPayload.Type;

export const RemoveEntityFromCollectionWorkflow = Workflow.make({
	success: MembershipResponse,
	name: "RemoveEntityFromCollectionWorkflow",
	error: RemoveEntityFromCollectionWorkflowError,
	idempotencyKey: ({ executionId }) => executionId,
	payload: RemoveEntityFromCollectionWorkflowPayload,
});

export const executeRemoveEntityFromCollection = (
	engine: Context.Tag.Service<typeof WorkflowEngine>,
	payload: RemoveEntityFromCollectionWorkflowPayload,
) =>
	engine.execute(RemoveEntityFromCollectionWorkflow, {
		payload,
		executionId: payload.executionId,
	});
