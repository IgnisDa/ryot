import { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	CollectionBadRequest,
	MembershipResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import { RelationshipMutationResult } from "@ryot-app/contract/modules/relationships/schemas";
import { EntityId, EventSchemaSlug, type RelationshipId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import type { LifecycleCommand } from "#lib/domain/lifecycle-command";
import type { DurableSchema } from "#lib/infrastructure/workflow";
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
	warnings: Schema.Array(AutomationWarning),
	memberOf: MembershipResponse.fields.memberOf,
	addEventSchemaSlug: Schema.NullOr(EventSchemaSlug),
});

const childCommand = (command: LifecycleCommand, itemIdentity: string): LifecycleCommand => ({
	...command,
	itemIdentity: stableStringify([command.itemIdentity, itemIdentity]),
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
		const compensate = Effect.fnUntraced(function* (relationshipId: RelationshipId) {
			const compensation = yield* Activity.make({
				name: "compensate-collection-membership",
				success: RelationshipMutationResult satisfies DurableSchema,
				error: AddEntityToCollectionWorkflowError satisfies DurableSchema,
				execute: operations.compensateMembership(
					payload.userId,
					relationshipId,
					childCommand(payload.command, `compensation:${relationshipId}`),
				),
			});
			if (compensation.warnings.length > 0) {
				yield* Effect.logWarning("collection membership compensation warnings", {
					warnings: compensation.warnings,
				});
			}
		});

		const result = yield* Activity.make({
			name: "write-collection-membership",
			success: WriteCollectionMembershipResult satisfies DurableSchema,
			error: AddEntityToCollectionWorkflowError satisfies DurableSchema,
			execute: operations.writeMembership({
				userId: payload.userId,
				command: payload.command,
				entityId: payload.entityId,
				properties: payload.properties,
				collectionId: payload.collectionId,
			}),
		});

		let eventWarnings: ReadonlyArray<AutomationWarning> = [];
		if (result.addEventSchemaSlug) {
			const eventExecutionId = `collection-membership-added-${result.memberOf.id}`;
			const eventAttempt = yield* engine
				.execute(EventCreateWorkflow, {
					executionId: eventExecutionId,
					payload: {
						userId: payload.userId,
						command: childCommand(payload.command, `event:${result.memberOf.id}`),
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
				yield* compensate(result.memberOf.id);
				yield* Effect.logWarning("collection membership event execution failed", {
					failure: eventAttempt.failure,
				});
				return yield* new CollectionBadRequest({ reason: { code: "membership-event-failed" } });
			}
			if (eventAttempt.success.failure) {
				yield* compensate(result.memberOf.id);
				yield* Effect.logWarning("collection membership event failed", {
					failure: eventAttempt.success.failure.reason,
				});
				return yield* new CollectionBadRequest({ reason: { code: "membership-event-failed" } });
			}
			eventWarnings = eventAttempt.success.warnings;
		}

		return { memberOf: result.memberOf, warnings: [...result.warnings, ...eventWarnings] };
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "AddEntityToCollectionWorkflow" }),
);

export const AddEntityToCollectionWorkflowDefinitionsLive = AddEntityToCollectionWorkflow.toLayer(
	runAddEntityToCollectionWorkflow,
);
