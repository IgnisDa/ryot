import { SandboxRunError } from "@ryot-app/contract/errors";
import type {
	EntityId,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect } from "effect";

import { EntitiesRepository } from "#modules/entities/repository";
import type {
	RelationshipMutationOutcome,
	RelationshipMutationSnapshot,
} from "#modules/relationships/mutation-outcomes";
import {
	RelationshipsRepository,
	relationshipMutationLockKey,
} from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

type RelationshipValue = {
	createdAt: string;
	id: RelationshipId;
	properties: unknown;
	sourceEntityId: EntityId;
	targetEntityId: EntityId;
	relationshipSchemaSlug: RelationshipSchemaSlug;
};

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
		} & ({ scope: "global" } | { scope: "user"; userId: UserId }),
	) {
		const relationships = yield* RelationshipsService;
		const entitiesRepository = yield* EntitiesRepository;
		const relationshipsRepository = yield* RelationshipsRepository;
		const relationshipInputFor = (entityId: EntityId) => ({
			relationshipSchemaSlug: input.relationshipSchemaSlug,
			relationshipSchemaPluginId: input.relationshipSchemaPluginId ?? null,
			sourceEntityId: input.direction === "outgoing" ? input.anchorEntityId : entityId,
			targetEntityId: input.direction === "outgoing" ? entityId : input.anchorEntityId,
			...(input.scope === "user"
				? { userId: input.userId, scope: "user" as const }
				: { scope: "global" as const }),
		});
		const entries = new Map(input.entries.map((entry) => [entry.entityId, entry]));
		const orderedEntries = [...entries.values()]
			.map((entry) => ({ entry, identity: relationshipInputFor(entry.entityId) }))
			.sort((left, right) =>
				relationshipMutationLockKey(left.identity).localeCompare(
					relationshipMutationLockKey(right.identity),
				),
			);
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
					)
			: relationshipsRepository.listGlobalRelationships({
					type: "anchored",
					direction: input.direction,
					anchorEntityId: input.anchorEntityId,
					relationshipSchemaSlug: input.relationshipSchemaSlug,
					relationshipSchemaPluginId: input.relationshipSchemaPluginId ?? null,
				});
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
		const endpointIds = new Set<EntityId>([input.anchorEntityId]);
		for (const entry of entries.values()) {
			endpointIds.add(entry.entityId);
		}
		for (const relationship of sortedExisting) {
			endpointIds.add(relationship.sourceEntityId);
			endpointIds.add(relationship.targetEntityId);
		}
		yield* entitiesRepository.lockEntityReferencesByIds([...endpointIds]);
		yield* relationshipsRepository.lockRelationshipMutations([
			...orderedEntries.map(({ identity }) => identity),
			...(input.synchronization === "authoritative"
				? sortedExisting.map((relationship) => ({
						sourceEntityId: relationship.sourceEntityId,
						targetEntityId: relationship.targetEntityId,
						relationshipSchemaSlug: relationship.relationshipSchemaSlug,
						relationshipSchemaPluginId: input.relationshipSchemaPluginId ?? null,
						...(input.scope === "user"
							? { userId: input.userId, scope: "user" as const }
							: { scope: "global" as const }),
					}))
				: []),
		]);
		const endpoints = yield* entitiesRepository.listEntityReferencesByIds([...endpointIds]);
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

		const outcomesByEntityId = new Map<EntityId, RelationshipMutationOutcome>();
		for (const { entry, identity } of orderedEntries) {
			const relationshipInput = {
				...identity,
				properties: entry.properties,
				propertiesSchema: input.propertiesSchema,
			};
			const current = existingByEntityId.get(entry.entityId);
			if (current) {
				const before = yield* toSnapshot(current);
				if (
					input.onConflict === "preserveExisting" ||
					Bun.deepEquals(current.properties, entry.properties)
				) {
					outcomesByEntityId.set(entry.entityId, { before, after: before, operation: "noop" });
					continue;
				}

				const updated = yield* relationships.update(relationshipInput);
				outcomesByEntityId.set(entry.entityId, {
					before,
					operation: "update",
					after: yield* toSnapshot(updated),
				});
				continue;
			}

			const created = yield* relationships.create(relationshipInput);
			const createdSnapshot = yield* toSnapshot(created);
			if (created.wasInserted) {
				outcomesByEntityId.set(entry.entityId, {
					before: null,
					operation: "create",
					after: createdSnapshot,
				});
				continue;
			}
			if (
				input.onConflict === "preserveExisting" ||
				Bun.deepEquals(created.properties, entry.properties)
			) {
				outcomesByEntityId.set(entry.entityId, {
					operation: "noop",
					after: createdSnapshot,
					before: createdSnapshot,
				});
				continue;
			}

			const updated = yield* relationships.update(relationshipInput);
			outcomesByEntityId.set(entry.entityId, {
				operation: "update",
				before: createdSnapshot,
				after: yield* toSnapshot(updated),
			});
		}

		const deletedOutcomes: RelationshipMutationOutcome[] = [];
		if (input.synchronization === "authoritative") {
			for (const relationship of sortedExisting) {
				const relatedEntityId =
					input.direction === "outgoing"
						? relationship.targetEntityId
						: relationship.sourceEntityId;
				if (entries.has(relatedEntityId)) {
					continue;
				}

				const deleted = yield* relationships.delete({
					sourceEntityId: relationship.sourceEntityId,
					targetEntityId: relationship.targetEntityId,
					relationshipSchemaSlug: relationship.relationshipSchemaSlug,
					relationshipSchemaPluginId: input.relationshipSchemaPluginId ?? null,
					...(input.scope === "user"
						? { userId: input.userId, scope: "user" as const }
						: { scope: "global" as const }),
				});
				if (!deleted) {
					return yield* new SandboxRunError({
						message: `Relationship disappeared during synchronization: ${relationship.id}`,
					});
				}
				deletedOutcomes.push({
					after: null,
					operation: "delete",
					before: yield* toSnapshot(relationship),
				});
			}
		}

		return [
			...[...entries.keys()].flatMap((entityId) => {
				const outcome = outcomesByEntityId.get(entityId);
				return outcome ? [outcome] : [];
			}),
			...deletedOutcomes,
		];
	},
);
