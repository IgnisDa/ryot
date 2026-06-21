import { Workflow } from "@effect/workflow";
import { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
import { MembershipResponse } from "@ryot/contract/modules/collections/schemas";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

export const AddEntityToCollectionWorkflowError = Schema.Union(BadRequest, DbError, NotFound);

export type AddEntityToCollectionWorkflowError = typeof AddEntityToCollectionWorkflowError.Type;

export const AddEntityToCollectionWorkflowPayload = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	collectionId: EntityId,
	executionId: Schema.String,
	properties: Schema.optional(Schema.Unknown),
});

export type AddEntityToCollectionWorkflowPayload = typeof AddEntityToCollectionWorkflowPayload.Type;

export const AddEntityToCollectionWorkflow = Workflow.make({
	success: MembershipResponse,
	name: "AddEntityToCollectionWorkflow",
	error: AddEntityToCollectionWorkflowError,
	payload: AddEntityToCollectionWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});
