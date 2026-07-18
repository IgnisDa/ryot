import { badRequest, notFound } from "@ryot/contract/errors";
import { MembershipResponse } from "@ryot/contract/modules/collections/schemas";
import { EntityId, EventSchemaSlug } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { withoutSchemaServices } from "#lib/shared/schema";
import { EventCreateWorkflow } from "#modules/events/event-create-workflow";

import {
	AddEntityToCollectionWorkflow,
	AddEntityToCollectionWorkflowError,
	type AddEntityToCollectionWorkflowPayload,
} from "./add-entity-to-collection-workflow";
import { CollectionsService } from "./service";

const WriteCollectionMembershipResult = Schema.Struct({
	entityId: EntityId,
	occurredAt: Schema.String,
	entitySchemaSlug: Schema.String,
	memberOf: MembershipResponse.fields.memberOf,
	addEventSchemaSlug: Schema.NullOr(EventSchemaSlug),
});

type AddEntityToCollectionWorkflowOperationsValue = {
	writeMembership: CollectionsService["Service"]["writeMembership"];
	compensateMembership: CollectionsService["Service"]["compensateMembership"];
};

export class AddEntityToCollectionWorkflowOperations extends Context.Service<
	AddEntityToCollectionWorkflowOperations,
	AddEntityToCollectionWorkflowOperationsValue
>()("AddEntityToCollectionWorkflowOperations") {}

export const AddEntityToCollectionWorkflowOperationsLive = Layer.effect(
	AddEntityToCollectionWorkflowOperations,
	Effect.map(CollectionsService, (collections) => ({
		writeMembership: collections.writeMembership,
		compensateMembership: collections.compensateMembership,
	})),
);

export const runAddEntityToCollectionWorkflow = Effect.fn("AddEntityToCollectionWorkflow")(
	function* (payload: AddEntityToCollectionWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			userId: payload.userId,
			entityId: payload.entityId,
			collectionId: payload.collectionId,
		});
		const engine = yield* WorkflowEngine;
		const operations = yield* AddEntityToCollectionWorkflowOperations;

		const result = yield* Activity.make({
			name: "write-collection-membership",
			success: withoutSchemaServices(WriteCollectionMembershipResult),
			error: withoutSchemaServices(AddEntityToCollectionWorkflowError),
			execute: operations.writeMembership({
				userId: payload.userId,
				entityId: payload.entityId,
				properties: payload.properties,
				collectionId: payload.collectionId,
			}),
		});

		if (result.addEventSchemaSlug) {
			const eventExecutionId = `collection-membership-added-${result.memberOf.id}`;
			const eventAttempt = yield* engine
				.execute(EventCreateWorkflow, {
					executionId: eventExecutionId,
					payload: {
						origin: "collection",
						userId: payload.userId,
						executionId: eventExecutionId,
						payload: [
							{
								occurredAt: result.occurredAt,
								entityId: payload.collectionId,
								eventSchemaSlug: result.addEventSchemaSlug,
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
				.pipe(Effect.result);
			if (eventAttempt._tag === "Failure") {
				yield* Activity.make({
					success: withoutSchemaServices(Schema.Boolean),
					name: "compensate-collection-membership",
					error: withoutSchemaServices(AddEntityToCollectionWorkflowError),
					execute: operations.compensateMembership(payload.userId, result.memberOf.id),
				});
				return yield* eventAttempt.failure;
			}
			if (eventAttempt.success.failure) {
				yield* Activity.make({
					success: withoutSchemaServices(Schema.Boolean),
					name: "compensate-collection-membership",
					error: withoutSchemaServices(AddEntityToCollectionWorkflowError),
					execute: operations.compensateMembership(payload.userId, result.memberOf.id),
				});
				const { reason } = eventAttempt.success.failure;
				return yield* reason.kind === "not_found"
					? notFound(reason.message)
					: badRequest(reason.message);
			}
		}

		return { memberOf: result.memberOf };
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "AddEntityToCollectionWorkflow" }),
);

export const AddEntityToCollectionWorkflowDefinitionsLive = AddEntityToCollectionWorkflow.toLayer(
	runAddEntityToCollectionWorkflow,
);
