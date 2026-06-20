import { Activity } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { MembershipResponse } from "@ryot/contract/modules/collections/schemas";
import { EventSchemaId } from "@ryot/contract/schema/brands";
import { Effect, Schema } from "effect";

import { EventCreateWorkflow } from "#modules/events/event-create-workflow";

import {
	RemoveEntityFromCollectionWorkflow,
	RemoveEntityFromCollectionWorkflowError,
	type RemoveEntityFromCollectionWorkflowPayload,
} from "./remove-entity-from-collection-workflow";
import { CollectionsService } from "./service";

const DeleteCollectionMembershipResult = Schema.Struct({
	occurredAt: Schema.String,
	entitySchemaSlug: Schema.String,
	memberOf: MembershipResponse.fields.memberOf,
	removeEventSchemaId: Schema.NullOr(EventSchemaId),
});

export const runRemoveEntityFromCollectionWorkflow = Effect.fn(
	"runRemoveEntityFromCollectionWorkflow",
)(function* (payload: RemoveEntityFromCollectionWorkflowPayload) {
	const engine = yield* WorkflowEngine;
	const collections = yield* CollectionsService;

	const result = yield* Activity.make({
		name: "delete-collection-membership",
		success: DeleteCollectionMembershipResult,
		error: RemoveEntityFromCollectionWorkflowError,
		execute: collections.deleteMembership({
			userId: payload.userId,
			entityId: payload.entityId,
			collectionId: payload.collectionId,
		}),
	});

	if (result.removeEventSchemaId) {
		const executionId = `collection-membership-removed-${result.memberOf.id}`;
		yield* engine.execute(EventCreateWorkflow, {
			executionId,
			discard: true,
			payload: {
				executionId,
				origin: "collection",
				userId: payload.userId,
				payload: [
					{
						occurredAt: result.occurredAt,
						entityId: payload.collectionId,
						eventSchemaId: result.removeEventSchemaId,
						properties: {
							entityId: payload.entityId,
							relationshipId: result.memberOf.id,
							entitySchemaSlug: result.entitySchemaSlug,
							relationshipProperties: result.memberOf.properties,
						},
					},
				],
			},
		});
	}

	return { memberOf: result.memberOf };
});

export const RemoveEntityFromCollectionWorkflowDefinitionsLive =
	RemoveEntityFromCollectionWorkflow.toLayer((payload) =>
		runRemoveEntityFromCollectionWorkflow(payload),
	);
