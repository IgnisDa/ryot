import { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
import { MembershipResponse } from "@ryot/contract/modules/collections/schemas";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import { withoutSchemaServices } from "#lib/shared/schema";

export const AddEntityToCollectionWorkflowError = Schema.Union([BadRequest, DbError, NotFound]);

export type AddEntityToCollectionWorkflowError = typeof AddEntityToCollectionWorkflowError.Type;

export const AddEntityToCollectionWorkflowPayload = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	collectionId: EntityId,
	executionId: Schema.String,
	properties: Schema.optional(Schema.Unknown),
});

export type AddEntityToCollectionWorkflowPayload = typeof AddEntityToCollectionWorkflowPayload.Type;

export const AddEntityToCollectionWorkflow = Workflow.make("AddEntityToCollectionWorkflow", {
	success: withoutSchemaServices(MembershipResponse),
	error: withoutSchemaServices(AddEntityToCollectionWorkflowError),
	payload: withoutSchemaServices(AddEntityToCollectionWorkflowPayload),
	idempotencyKey: ({ executionId }) => executionId,
});
