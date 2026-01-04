import { Activity } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { MembershipResponse } from "@ryot/contract/modules/collections/schemas";
import { EntityId, EventSchemaId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Schema } from "effect";

import { EventCreateWorkflow } from "#modules/events/event-create-workflow";

import {
	AddEntityToCollectionWorkflow,
	AddEntityToCollectionWorkflowError,
	type AddEntityToCollectionWorkflowPayload,
} from "./add-entity-to-collection-workflow";
import { CollectionsService } from "./service";

const WriteCollectionMembershipResult = Schema.Struct({
	entityId: EntityId,
	wasInserted: Schema.Boolean,
	occurredAt: Schema.String,
	entitySchemaSlug: Schema.String,
	memberOf: MembershipResponse.fields.memberOf,
	addEventSchemaId: Schema.NullOr(EventSchemaId),
});

export const runAddEntityToCollectionWorkflow = Effect.fn("runAddEntityToCollectionWorkflow")(
	function* (payload: AddEntityToCollectionWorkflowPayload) {
		const engine = yield* WorkflowEngine;
		const collections = yield* CollectionsService;

		const result = yield* Activity.make({
			name: "write-collection-membership",
			success: WriteCollectionMembershipResult,
			error: AddEntityToCollectionWorkflowError,
			execute: collections.writeMembership({
				userId: payload.userId,
				entityId: payload.entityId,
				properties: payload.properties,
				collectionId: payload.collectionId,
			}),
		});

		if (result.wasInserted && result.addEventSchemaId) {
			const executionId = `collection-membership-added-${result.memberOf.id}`;
			yield* engine
				.execute(EventCreateWorkflow, {
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
								eventSchemaId: result.addEventSchemaId,
								properties: {
									entityId: result.entityId,
									relationshipId: result.memberOf.id,
									entitySchemaSlug: result.entitySchemaSlug,
									relationshipProperties: result.memberOf.properties,
								},
							},
						],
					},
				})
				.pipe(
					Effect.catchAllCause((cause) =>
						Effect.logWarning(`Failed to queue collection event: ${String(Cause.squash(cause))}`),
					),
				);
		}

		return { memberOf: result.memberOf };
	},
);

export const AddEntityToCollectionWorkflowDefinitionsLive = AddEntityToCollectionWorkflow.toLayer(
	(payload) => runAddEntityToCollectionWorkflow(payload),
);
