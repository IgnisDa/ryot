import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import { CollectionBadRequest } from "@ryot-app/contract/modules/collections/schemas";
import type { RelationshipId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import type { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { runLifecycleWriteStep } from "#lib/infrastructure/lifecycle-workflow-step";
import { implementWorkflow } from "#lib/infrastructure/workflow-scope";
import { EventCreateWorkflow } from "#modules/events/event-create-workflow";
import {
	PendingRelationshipMutations,
	RelationshipSingleResult,
} from "#modules/relationships/mutation-pipeline";

import {
	AddEntityToCollectionWorkflow,
	AddEntityToCollectionWorkflowError,
	type AddEntityToCollectionWorkflowPayload,
} from "./add-entity-to-collection-workflow";
import {
	CollectionMembershipResult,
	CollectionsService,
	PendingCollectionMembership,
} from "./service";

const childCommand = (command: LifecycleCommand, itemIdentity: string): LifecycleCommand => ({
	...command,
	itemIdentity: stableStringify([command.itemIdentity, itemIdentity]),
});

type AddEntityToCollectionWorkflowOperationsValue = Pick<
	CollectionsService["Service"],
	| "commitMembership"
	| "prepareMembership"
	| "commitCompensation"
	| "prepareCompensation"
	| "applyMembershipPolicies"
	| "applyCompensationPolicies"
>;

export class AddEntityToCollectionWorkflowOperations extends Context.Service<
	AddEntityToCollectionWorkflowOperations,
	AddEntityToCollectionWorkflowOperationsValue
>()("AddEntityToCollectionWorkflowOperations") {}

export const AddEntityToCollectionWorkflowOperationsLive = Layer.effect(
	AddEntityToCollectionWorkflowOperations,
	Effect.map(CollectionsService, (collections) => ({
		commitMembership: collections.commitMembership,
		prepareMembership: collections.prepareMembership,
		commitCompensation: collections.commitCompensation,
		prepareCompensation: collections.prepareCompensation,
		applyMembershipPolicies: collections.applyMembershipPolicies,
		applyCompensationPolicies: collections.applyCompensationPolicies,
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
			const compensation = yield* runLifecycleWriteStep({
				result: RelationshipSingleResult,
				pending: PendingRelationshipMutations,
				commit: operations.commitCompensation,
				error: AddEntityToCollectionWorkflowError,
				applyPolicies: operations.applyCompensationPolicies,
				name: `compensate-collection-membership:${relationshipId}`,
				prepare: operations.prepareCompensation(
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

		const { result, warnings } = yield* runLifecycleWriteStep({
			result: CollectionMembershipResult,
			name: "write-collection-membership",
			commit: operations.commitMembership,
			pending: PendingCollectionMembership,
			error: AddEntityToCollectionWorkflowError,
			applyPolicies: operations.applyMembershipPolicies,
			prepare: operations.prepareMembership({
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

		return { memberOf: result.memberOf, warnings: [...warnings, ...eventWarnings] };
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "AddEntityToCollectionWorkflow" }),
);

export const AddEntityToCollectionWorkflowDefinitionsLive = implementWorkflow(
	AddEntityToCollectionWorkflow,
	runAddEntityToCollectionWorkflow,
);
