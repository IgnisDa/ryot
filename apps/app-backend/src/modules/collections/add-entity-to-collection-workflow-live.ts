import { Activity } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { MembershipResponse } from "@ryot/contract/modules/collections/schemas";
import { EntityId, EventSchemaId } from "@ryot/contract/schema/brands";
import { Effect, Schema } from "effect";

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

export const runAddEntityToCollectionWorkflow = Effect.fn("AddEntityToCollectionWorkflow")(
	function* (payload: AddEntityToCollectionWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			userId: payload.userId,
			entityId: payload.entityId,
			collectionId: payload.collectionId,
		});
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
			const eventExecutionId = `collection-membership-added-${result.memberOf.id}`;
			yield* engine
				.execute(EventCreateWorkflow, {
					executionId: eventExecutionId,
					discard: true,
					payload: {
						executionId: eventExecutionId,
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
						Effect.logWarning("collection event enqueue failed", cause),
					),
				);
		}

		return { memberOf: result.memberOf };
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "AddEntityToCollectionWorkflow" }),
);

export const AddEntityToCollectionWorkflowDefinitionsLive = AddEntityToCollectionWorkflow.toLayer(
	(payload, executionId) => runAddEntityToCollectionWorkflow(payload, executionId),
);
