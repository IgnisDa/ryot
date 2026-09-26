import { DbError } from "@ryot-app/contract/errors";
import {
	CollectionBadRequest,
	CollectionNotFound,
	MembershipResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";
import { Workflow } from "effect/workflow";

import type { DurableSchema } from "#boot/workflow-engine";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { RelationshipSingleResult } from "#modules/relationships/mutation-pipeline";

const CollectionMembershipWorkflowResult = Schema.Struct({
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
	executionId: Schema.String,
	command: DomainLifecycleCommand,
	properties: Schema.optional(Schema.Unknown),
});

export type AddEntityToCollectionWorkflowPayload = typeof AddEntityToCollectionWorkflowPayload.Type;

export const AddEntityToCollectionWorkflow = Workflow.make("AddEntityToCollectionWorkflow", {
	idempotencyKey: ({ executionId }) => executionId,
	error: AddEntityToCollectionWorkflowError satisfies DurableSchema,
	success: CollectionMembershipWorkflowResult satisfies DurableSchema,
	payload: AddEntityToCollectionWorkflowPayload satisfies DurableSchema,
});
