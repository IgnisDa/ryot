import { DbError } from "@ryot-app/contract/errors";
import {
	CollectionBadRequest,
	CollectionNotFound,
	CreateMembershipBody,
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

export const CollectionMembershipWorkflowError = Schema.Union([
	DbError,
	CollectionBadRequest,
	CollectionNotFound,
]);

export type CollectionMembershipWorkflowError = typeof CollectionMembershipWorkflowError.Type;

export const CollectionMembershipWorkflowPayload = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	collectionId: EntityId,
	executionId: Schema.String,
	command: DomainLifecycleCommand,
	mode: CreateMembershipBody.fields.mode,
	properties: Schema.optional(Schema.Unknown),
	operation: Schema.Literals(["add", "remove"]),
});

export type CollectionMembershipWorkflowPayload = typeof CollectionMembershipWorkflowPayload.Type;

export const CollectionMembershipWorkflow = Workflow.make("CollectionMembershipWorkflow", {
	idempotencyKey: ({ executionId }) => executionId,
	error: CollectionMembershipWorkflowError satisfies DurableSchema,
	success: CollectionMembershipWorkflowResult satisfies DurableSchema,
	payload: CollectionMembershipWorkflowPayload satisfies DurableSchema,
});
