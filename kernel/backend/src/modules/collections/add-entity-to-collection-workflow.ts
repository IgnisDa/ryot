import { DbError } from "@ryot-app/contract/errors";
import {
	CollectionBadRequest,
	CollectionNotFound,
	MembershipResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import { LifecycleCommand } from "#lib/domain/lifecycle-command";
import type { DurableSchema } from "#lib/infrastructure/workflow";

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

export const AddEntityToCollectionWorkflow = Workflow.make("AddEntityToCollectionWorkflow", {
	idempotencyKey: ({ executionId }) => executionId,
	success: MembershipResponse satisfies DurableSchema,
	error: AddEntityToCollectionWorkflowError satisfies DurableSchema,
	payload: AddEntityToCollectionWorkflowPayload satisfies DurableSchema,
});
