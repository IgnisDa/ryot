import { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
import { MembershipResponse } from "@ryot/contract/modules/collections/schemas";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

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
	success: MembershipResponse satisfies DurableSchema,
	error: AddEntityToCollectionWorkflowError satisfies DurableSchema,
	payload: AddEntityToCollectionWorkflowPayload satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
});
