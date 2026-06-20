import { SandboxRunError, mapDbErrorToSandbox } from "@ryot/contract/errors";
import type {
	EntityId,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { EntitiesRepository } from "#modules/entities/repository";
import type {
	RelationshipMutationOutcome,
	RelationshipMutationSnapshot,
} from "#modules/relationships/mutation-outcomes";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

type RelationshipValue = {
	createdAt: string;
	id: RelationshipId;
	properties: unknown;
	sourceEntityId: EntityId;
	targetEntityId: EntityId;
	relationshipSchemaSlug: RelationshipSchemaSlug;
};

const toSandboxRunError = (error: { message: string }) =>
	new SandboxRunError({ message: error.message });

export const synchronizeGlobalRelationships = Effect.fn("synchronizeGlobalRelationships")(
	function* (
		input: {
			anchorEntityId: EntityId;
			propertiesSchema: AppSchema;
			direction: "incoming" | "outgoing";
			synchronization: "additive" | "authoritative";
			relationshipSchemaSlug: RelationshipSchemaSlug;
			onConflict: "preserveExisting" | "replaceProperties";
			relationshipSchemaPluginId?: string | null | undefined;
			entries: ReadonlyArray<{ entityId: EntityId; properties: Record<string, unknown> }>;
		} & ({ scope?: "global" } | { scope: "user"; userId: UserId }),
	) {
		const relationships = yield* RelationshipsService;
		const entitiesRepository = yield* EntitiesRepository;
		const relationshipsRepository = yield* RelationshipsRepository;
		const existing = yield* input.scope === "user"
			? relationshipsRepository
					.listUserRelationshipsForEntityWithProvenance({
						userId: input.userId,
						entityId: input.anchorEntityId,
					})
					.pipe(
						Effect.map((rows) =>
							rows.filter(
								(row) =>
									row.relationshipSchemaSlug === input.relationshipSchemaSlug &&
									(row.relationshipSchemaPluginId ?? null) ===
										(input.relationshipSchemaPluginId ?? null) &&
									(input.direction === "outgoing"
										? row.sourceEntityId === input.anchorEntityId
										: row.targetEntityId === input.anchorEntityId),
							),
						),
						mapDbErrorToSandbox,
					)
			: relationshipsRepository
					.listGlobalRelationships({
						type: "anchored",
						direction: input.direction,
						anchorEntityId: input.anchorEntityId,
						relationshipSchemaSlug: input.relationshipSchemaSlug,
						relationshipSchemaPluginId: input.relationshipSchemaPluginId ?? null,
					})
					.pipe(mapDbErrorToSandbox);
		const sortedExisting = [...existing].sort(
			(left, right) =>
				left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
		);
		const existingByEntityId = new Map(
			sortedExisting.map((relationship) => [
				input.direction === "outgoing" ? relationship.targetEntityId : relationship.sourceEntityId,
				relationship,
			]),
		);
		const entries = new Map(input.entries.map((entry) => [entry.entityId, entry]));
		const endpointIds = new Set<EntityId>([input.anchorEntityId]);
		for (const entry of entries.values()) {
			endpointIds.add(entry.entityId);
		}
		for (const relationship of sortedExisting) {
			endpointIds.add(relationship.sourceEntityId);
			endpointIds.add(relationship.targetEntityId);
		}
		const endpoints = yield* entitiesRepository
			.listEntityReferencesByIds([...endpointIds])
			.pipe(mapDbErrorToSandbox);
		const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));

		const toSnapshot = Effect.fn("toRelationshipMutationSnapshot")(function* (
			relationship: RelationshipValue,
		) {
			const sourceEntity = endpointsById.get(relationship.sourceEntityId);
			const targetEntity = endpointsById.get(relationship.targetEntityId);
			if (!sourceEntity || !targetEntity) {
				return yield* new SandboxRunError({
					message: `Relationship endpoint not found: ${relationship.sourceEntityId} -> ${relationship.targetEntityId}`,
				});
			}

			return {
				sourceEntity,
				targetEntity,
				id: relationship.id,
				properties: relationship.properties,
				relationshipSchemaSlug: relationship.relationshipSchemaSlug,
			} satisfies RelationshipMutationSnapshot;
		});

		const outcomes: RelationshipMutationOutcome[] = [];
		for (const entry of entries.values()) {
			const sourceEntityId = input.direction === "outgoing" ? input.anchorEntityId : entry.entityId;
			const targetEntityId = input.direction === "outgoing" ? entry.entityId : input.anchorEntityId;
			const relationshipInput = {
				sourceEntityId,
				targetEntityId,
				properties: entry.properties,
				propertiesSchema: input.propertiesSchema,
				relationshipSchemaSlug: input.relationshipSchemaSlug,
				relationshipSchemaPluginId: input.relationshipSchemaPluginId ?? null,
				...(input.scope === "user"
					? { scope: "user" as const, userId: input.userId }
					: { scope: "global" as const }),
			};
			const current = existingByEntityId.get(entry.entityId);
			if (current) {
				const before = yield* toSnapshot(current);
				if (
					input.onConflict === "preserveExisting" ||
					Bun.deepEquals(current.properties, entry.properties)
				) {
					outcomes.push({ before, after: before, operation: "noop" });
					continue;
				}

				const updateRelationship = relationships
					.update(relationshipInput)
					.pipe(Effect.mapError(toSandboxRunError));
				const updated = yield* updateRelationship;
				outcomes.push({ before, after: yield* toSnapshot(updated), operation: "update" });
				continue;
			}

			const createRelationship = relationships
				.create(relationshipInput)
				.pipe(Effect.mapError(toSandboxRunError));
			const created = yield* createRelationship;
			const createdSnapshot = yield* toSnapshot(created);
			if (created.wasInserted) {
				outcomes.push({ before: null, after: createdSnapshot, operation: "create" });
				continue;
			}
			if (
				input.onConflict === "preserveExisting" ||
				Bun.deepEquals(created.properties, entry.properties)
			) {
				outcomes.push({ before: createdSnapshot, after: createdSnapshot, operation: "noop" });
				continue;
			}

			const updateCreatedRelationship = relationships
				.update(relationshipInput)
				.pipe(Effect.mapError(toSandboxRunError));
			const updated = yield* updateCreatedRelationship;
			outcomes.push({
				operation: "update",
				before: createdSnapshot,
				after: yield* toSnapshot(updated),
			});
		}

		if (input.synchronization === "authoritative") {
			for (const relationship of sortedExisting) {
				const relatedEntityId =
					input.direction === "outgoing"
						? relationship.targetEntityId
						: relationship.sourceEntityId;
				if (entries.has(relatedEntityId)) {
					continue;
				}

				const deleteRelationship = relationships
					.delete({
						sourceEntityId: relationship.sourceEntityId,
						targetEntityId: relationship.targetEntityId,
						relationshipSchemaSlug: relationship.relationshipSchemaSlug,
						relationshipSchemaPluginId: input.relationshipSchemaPluginId ?? null,
						...(input.scope === "user"
							? { scope: "user" as const, userId: input.userId }
							: { scope: "global" as const }),
					})
					.pipe(Effect.mapError(toSandboxRunError));
				const deleted = yield* deleteRelationship;
				if (!deleted) {
					return yield* new SandboxRunError({
						message: `Relationship disappeared during synchronization: ${relationship.id}`,
					});
				}
				outcomes.push({
					after: null,
					operation: "delete",
					before: yield* toSnapshot(relationship),
				});
			}
		}

		return outcomes;
	},
);
