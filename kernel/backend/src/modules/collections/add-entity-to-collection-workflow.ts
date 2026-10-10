import { DbError } from "@ryot-app/contract/errors";
import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	CollectionBadRequest,
	CollectionNotFound,
	MembershipResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

import type { DurableSchema } from "#lib/infrastructure/workflow";
import { laneWorkflow } from "#lib/infrastructure/workflow-lane";
import { RelationshipSingleResult } from "#modules/relationships/mutation-pipeline";

export const CollectionMembershipWorkflowResult = Schema.Struct({
	...MembershipResponse.fields,
	operation: RelationshipSingleResult.fields.operation,
});

export const AddEntityToCollectionWorkflowError = Schema.Union([
	DbError,
	CollectionBadRequest,
	CollectionNotFound,
]);

export type AddEntityToCollectionWorkflowError = typeof AddEntityToCollectionWorkflowError.Type;

export const AddEntityToCollectionWorkflowPayload = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	collectionId: EntityId,
	command: LifecycleCommand,
	executionId: Schema.String,
	properties: Schema.optional(Schema.Unknown),
});

export type AddEntityToCollectionWorkflowPayload = typeof AddEntityToCollectionWorkflowPayload.Type;

export const AddEntityToCollectionWorkflow = laneWorkflow("AddEntityToCollectionWorkflow", {
	idempotencyKey: ({ executionId }) => executionId,
	error: AddEntityToCollectionWorkflowError satisfies DurableSchema,
	success: CollectionMembershipWorkflowResult satisfies DurableSchema,
	payload: AddEntityToCollectionWorkflowPayload satisfies DurableSchema,
});
