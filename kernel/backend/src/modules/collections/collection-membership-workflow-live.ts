import { CollectionBadRequest } from "@ryot-app/contract/modules/collections/schemas";
import { Context, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { runLifecycleWriteStep } from "#modules/automations/lifecycle/write-step";
import {
	type DomainLifecycleCommand,
	kernelCollectionLifecycleCommand,
} from "#modules/entities/write-context";
import { EventCreateWorkflow } from "#modules/events/event-create-workflow";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	PendingRelationshipMutations,
	RelationshipSingleResult,
} from "#modules/relationships/mutation-pipeline";
import { implementWorkflow } from "#platform/workflow/scope";

import {
	CollectionMembershipWorkflow,
	CollectionMembershipWorkflowError,
	type CollectionMembershipWorkflowPayload,
} from "./collection-membership-workflow";
import {
	childCollectionLifecycleCommand,
	CollectionMembershipResult,
	CollectionsService,
	PendingCollectionMembership,
} from "./service";

type CollectionMembershipWorkflowOperationsValue = Pick<
	CollectionsService["Service"],
	| "prepareRemoval"
	| "commitMembership"
	| "prepareMembership"
	| "commitCompensation"
	| "prepareRestoration"
	| "prepareCompensation"
	| "applyMembershipPolicies"
	| "applyCompensationPolicies"
>;

export class CollectionMembershipWorkflowOperations extends Context.Service<
	CollectionMembershipWorkflowOperations,
	CollectionMembershipWorkflowOperationsValue
>()("CollectionMembershipWorkflowOperations") {}

export const CollectionMembershipWorkflowOperationsLive = Layer.effect(
	CollectionMembershipWorkflowOperations,
	Effect.map(CollectionsService, (collections) => ({
		prepareRemoval: collections.prepareRemoval,
		commitMembership: collections.commitMembership,
		prepareMembership: collections.prepareMembership,
		commitCompensation: collections.commitCompensation,
		prepareRestoration: collections.prepareRestoration,
		prepareCompensation: collections.prepareCompensation,
		applyMembershipPolicies: collections.applyMembershipPolicies,
		applyCompensationPolicies: collections.applyCompensationPolicies,
	})),
);

const membershipEvents = {
	add: { eventLabel: "added", compensation: "compensate", stepName: "write-collection-membership" },
	remove: {
		eventLabel: "removed",
		compensation: "restore",
		stepName: "remove-collection-membership",
	},
} as const;

export const runCollectionMembershipWorkflow = Effect.fn("CollectionMembershipWorkflow")(
	function* (payload: CollectionMembershipWorkflowPayload, executionId: string) {
		const command = kernelCollectionLifecycleCommand(payload.command);
		const receipts = yield* MutationReceipts.make;
		yield* admitWorkflow(
			receipts,
			CollectionMembershipWorkflow,
			command.accountGeneration,
			executionId,
		);
		yield* Effect.annotateCurrentSpan({
			executionId,
			userId: payload.userId,
			entityId: payload.entityId,
			operation: payload.operation,
			collectionId: payload.collectionId,
		});
		const engine = yield* WorkflowEngine;
		const operations = yield* CollectionMembershipWorkflowOperations;
		const target = {
			command,
			userId: payload.userId,
			entityId: payload.entityId,
			collectionId: payload.collectionId,
		};
		const naming = membershipEvents[payload.operation];

		const { result, warnings } = yield* runLifecycleWriteStep({
			name: naming.stepName,
			result: CollectionMembershipResult,
			commit: operations.commitMembership,
			pending: PendingCollectionMembership,
			error: CollectionMembershipWorkflowError,
			applyPolicies: operations.applyMembershipPolicies,
			prepare:
				payload.operation === "add"
					? operations.prepareMembership({
							...target,
							mode: payload.mode,
							properties: payload.properties,
						})
					: operations.prepareRemoval(target),
		});

		const compensate = Effect.fnUntraced(function* () {
			const relationshipId = result.memberOf.id;
			const childCommand: DomainLifecycleCommand = childCollectionLifecycleCommand(
				command,
				`compensation:${relationshipId}`,
			);
			const compensation = yield* runLifecycleWriteStep({
				result: RelationshipSingleResult,
				pending: PendingRelationshipMutations,
				commit: operations.commitCompensation,
				error: CollectionMembershipWorkflowError,
				applyPolicies: operations.applyCompensationPolicies,
				name: `${naming.compensation}-collection-membership:${relationshipId}`,
				prepare:
					payload.operation === "add"
						? operations.prepareCompensation(payload.userId, relationshipId, childCommand)
						: operations.prepareRestoration({
								...target,
								command: childCommand,
								properties: result.memberOf.properties,
							}),
			});
			if (compensation.warnings.length > 0) {
				yield* Effect.logWarning("collection membership compensation warnings", {
					warnings: compensation.warnings,
				});
			}
		});

		if (!result.eventSchemaSlug) {
			return { warnings, memberOf: result.memberOf, operation: result.operation };
		}
		const eventAttempt = yield* dispatchAdmittedWorkflow(
			receipts,
			engine,
			EventCreateWorkflow,
			payload.command.accountGeneration,
			{
				executionId: `collection-membership-${naming.eventLabel}-${result.memberOf.id}`,
				payload: {
					userId: payload.userId,
					command: childCollectionLifecycleCommand(command, `event:${result.memberOf.id}`),
					payload: [
						{
							occurredAt: result.occurredAt,
							entityId: payload.collectionId,
							eventSchemaSlug: result.eventSchemaSlug,
							properties: {
								entityId: result.entityId,
								relationshipId: result.memberOf.id,
								entitySchemaSlug: result.entitySchemaSlug,
								relationshipProperties: result.memberOf.properties,
							},
						},
					],
				},
			},
			(admission) => admission,
			(execution) => execution.pipe(Effect.result),
		);
		const failure =
			eventAttempt._tag === "Failure" ? eventAttempt.failure : eventAttempt.success.failure?.reason;
		if (failure !== undefined) {
			yield* compensate();
			yield* Effect.logWarning("collection membership event failed", { failure });
			return yield* new CollectionBadRequest({ reason: { code: "membership-event-failed" } });
		}

		return {
			memberOf: result.memberOf,
			operation: result.operation,
			warnings: [
				...warnings,
				...(eventAttempt._tag === "Success" ? eventAttempt.success.warnings : []),
			],
		};
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "CollectionMembershipWorkflow" }),
);

export const CollectionMembershipWorkflowDefinitionsLive = implementWorkflow(
	CollectionMembershipWorkflow,
	runCollectionMembershipWorkflow,
);
