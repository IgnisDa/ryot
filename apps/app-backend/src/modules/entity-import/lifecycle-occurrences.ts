import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { asRecord } from "@ryot/ts-utils/predicates";
import { DateTime } from "effect";

import type { LifecycleOccurrence } from "#modules/automations/lifecycle-dispatch";
import type { GlobalRelationshipSyncOutcome } from "#modules/relationships/repository-support";

import type { PopulationMutationResult } from "./population";

const relationshipMutationIdentity = (
	mutation: GlobalRelationshipSyncOutcome["mutations"][number],
) => {
	const snapshot = mutation.after ?? mutation.before;
	return snapshot
		? `${snapshot.source.id}:${snapshot.target.id}:${mutation.operation}`
		: mutation.operation;
};

export const buildLifecycleOccurrences = (input: {
	root: ListedEntity;
	executionId: string;
	rootSchemaSlug: string;
	origin: AutomationOrigin;
	rootPreviouslyPopulated: boolean;
	mutations: PopulationMutationResult;
}): ReadonlyArray<LifecycleOccurrence> => {
	const committedAt = DateTime.unsafeMake(input.root.updatedAt);
	const scopeEntity = {
		id: input.root.id,
		name: input.root.name,
		entitySchemaSlug: input.rootSchemaSlug,
		entitySchemaId: input.root.entitySchemaId,
	};
	const entityOccurrences = input.mutations.entities.flatMap((mutation) => {
		if (mutation.outcome.operation === "noop") {
			return [];
		}
		const after = {
			id: mutation.outcome.entity.id,
			name: mutation.outcome.entity.name,
			entitySchemaSlug: mutation.entitySchemaSlug,
			entitySchemaId: mutation.outcome.entity.entitySchemaId,
			properties: asRecord(mutation.outcome.entity.properties) ?? {},
		};
		const before =
			mutation.outcome.operation === "update"
				? {
						id: mutation.outcome.before.id,
						name: mutation.outcome.before.name,
						entitySchemaSlug: mutation.entitySchemaSlug,
						entitySchemaId: mutation.outcome.before.entitySchemaId,
						properties: asRecord(mutation.outcome.before.properties) ?? {},
					}
				: undefined;
		const occurrenceId = `${input.executionId}:entity:${after.id}:${mutation.outcome.operation}`;
		return [
			{
				userId: null,
				correlationId: input.executionId,
				target: { kind: "entity" as const, schemaId: after.entitySchemaId },
				automation: {
					committedAt,
					scopeEntity,
					occurrenceId,
					automationDepth: 1,
					origin: input.origin,
					operation: mutation.outcome.operation,
					rootPreviouslyPopulated: input.rootPreviouslyPopulated,
					...(mutation.owningSeason ? { owningSeason: mutation.owningSeason } : {}),
					source: { after, kind: "entity" as const, ...(before ? { before } : {}) },
				},
			},
		];
	});
	const relationshipOccurrences = input.mutations.relationships.flatMap((sync) => {
		const material = sync.outcome.mutations.filter((mutation) => mutation.operation !== "noop");
		const leader = [...material].sort((left, right) =>
			relationshipMutationIdentity(left).localeCompare(relationshipMutationIdentity(right)),
		)[0];
		const batchId = `${input.executionId}:relationship-batch:${sync.relationshipSchemaId}:${sync.direction}:${sync.anchorEntityId}`;
		return material.map((mutation) => {
			if (mutation.operation === "noop") {
				throw new Error("Noop relationship mutation reached lifecycle dispatch");
			}
			const snapshot = mutation.after ?? mutation.before;
			if (!snapshot) {
				throw new Error("Material relationship mutation has no snapshot");
			}
			const occurrenceId = `${input.executionId}:relationship:${sync.relationshipSchemaId}:${sync.direction}:${snapshot.source.id}:${snapshot.target.id}:${mutation.operation}`;
			return {
				userId: null,
				correlationId: input.executionId,
				target: { kind: "relationship" as const, schemaId: sync.relationshipSchemaId },
				automation: {
					committedAt,
					scopeEntity,
					occurrenceId,
					automationDepth: 1,
					origin: input.origin,
					operation: mutation.operation,
					rootPreviouslyPopulated: input.rootPreviouslyPopulated,
					...(sync.owningSeason ? { owningSeason: sync.owningSeason } : {}),
					source: {
						kind: "relationship" as const,
						...(mutation.after ? { after: mutation.after } : {}),
						...(mutation.before ? { before: mutation.before } : {}),
					},
					batch: {
						id: batchId,
						isLeader: mutation === leader,
						afterCount: sync.outcome.afterCount,
						beforeCount: sync.outcome.beforeCount,
						createdCount: material.filter((value) => value.operation === "create").length,
						deletedCount: material.filter((value) => value.operation === "delete").length,
						updatedCount: material.filter((value) => value.operation === "update").length,
					},
				},
			} satisfies LifecycleOccurrence;
		});
	});
	return [...entityOccurrences, ...relationshipOccurrences];
};
