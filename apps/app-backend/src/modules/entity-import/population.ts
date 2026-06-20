import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type { SandboxExecutionError } from "@ryot/contract/modules/sandbox/schemas";
import type {
	EntitySchemaId,
	EntityId,
	RelationshipSchemaId,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import type { ProviderDetailsChildEntity } from "@ryot/sandbox-sdk/provider";
import { DateTime, Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

export const decodeSandboxDriverResult = <A, E, R>(
	result: { error: SandboxExecutionError | null; value: unknown },
	decode: (input: unknown) => Effect.Effect<A, E, R>,
	errorMessage: string,
): Effect.Effect<A, SandboxRunError, R> =>
	result.error
		? Effect.fail(new SandboxRunError({ message: result.error.message }))
		: decode(result.value).pipe(
				Effect.mapError(() => new SandboxRunError({ message: errorMessage })),
			);

export type ProcessedChildEntity = {
	entity: ListedEntity;
	entitySchemaId: EntitySchemaId;
};

export const writeChildEntitySet = Effect.fn("writeChildEntitySet")(function* (input: {
	syncExisting?: boolean;
	parentEntityId: EntityId;
	sandboxScriptId: SandboxScriptId;
	parentEntitySchemaId: EntitySchemaId;
	parentEntitySchemaSlug?: string | undefined;
	childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
	childEntitySchemaSlugs?: Readonly<Record<string, string>> | undefined;
}) {
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const relationships = yield* RelationshipsService;
	const relationshipsRepository = yield* RelationshipsRepository;
	const entitySchemasRepository = yield* EntitySchemasRepository;
	const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

	const findChildRelationshipSchema = Effect.fn("findChildRelationshipSchema")(function* (
		sourceEntitySchemaId: EntitySchemaId,
		sourceEntitySchemaSlug: string | undefined,
		targetEntitySchemaId: EntitySchemaId | undefined,
	) {
		let targetSchemaId = targetEntitySchemaId;
		if (!targetSchemaId && sourceEntitySchemaSlug) {
			const targetSchemaSlug = input.childEntitySchemaSlugs?.[sourceEntitySchemaSlug];
			if (targetSchemaSlug) {
				const targetSchema = yield* runWithDb(
					entitySchemasRepository.getBuiltinBySlug(targetSchemaSlug),
				).pipe(dieOnDbError);
				targetSchemaId = targetSchema?.id;
			}
		}
		if (!targetSchemaId) {
			return null;
		}
		const relationshipSchema = yield* runWithDb(
			relationshipSchemasRepository.findGlobalBySchemaIds({
				sourceEntitySchemaId,
				targetEntitySchemaId: targetSchemaId,
			}),
		).pipe(dieOnDbError);
		if (!relationshipSchema && targetEntitySchemaId) {
			return yield* new SandboxRunError({
				message: `Child relationship schema not found: ${sourceEntitySchemaId} -> ${targetEntitySchemaId}`,
			});
		}
		return relationshipSchema;
	});

	const synchronizeGlobalRelationships = Effect.fn(
		"synchronizeGlobalRelationshipsInEntityPopulation",
	)(function* (syncInput: {
		anchorEntityId: EntityId;
		propertiesSchema: AppSchema;
		direction: "incoming" | "outgoing";
		relationshipSchemaId: RelationshipSchemaId;
		synchronization: "additive" | "authoritative";
		onConflict: "preserveExisting" | "replaceProperties";
		entries: ReadonlyArray<{ entityId: EntityId; properties: Record<string, unknown> }>;
	}) {
		const existing = yield* runWithDb(
			relationshipsRepository.listGlobalRelationships({
				type: "anchored",
				direction: syncInput.direction,
				anchorEntityId: syncInput.anchorEntityId,
				relationshipSchemaId: syncInput.relationshipSchemaId,
			}),
		).pipe(dieOnDbError);
		const existingByEntityId = new Map(
			existing.map((relationship) => [
				syncInput.direction === "outgoing"
					? relationship.targetEntityId
					: relationship.sourceEntityId,
				relationship,
			]),
		);
		const entries = new Map(syncInput.entries.map((entry) => [entry.entityId, entry]));

		for (const entry of entries.values()) {
			const sourceEntityId =
				syncInput.direction === "outgoing" ? syncInput.anchorEntityId : entry.entityId;
			const targetEntityId =
				syncInput.direction === "outgoing" ? entry.entityId : syncInput.anchorEntityId;
			const identity = {
				sourceEntityId,
				targetEntityId,
				scope: "global" as const,
				relationshipSchemaId: syncInput.relationshipSchemaId,
			};
			const relationshipInput = {
				...identity,
				properties: entry.properties,
				propertiesSchema: syncInput.propertiesSchema,
			};
			const current = existingByEntityId.get(entry.entityId);
			if (current) {
				if (syncInput.onConflict === "replaceProperties") {
					yield* relationships
						.update(relationshipInput)
						.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
				}
				continue;
			}

			const created = yield* relationships
				.create(relationshipInput)
				.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
			if (!created.wasInserted && syncInput.onConflict === "replaceProperties") {
				yield* relationships
					.update(relationshipInput)
					.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
			}
		}

		if (syncInput.synchronization === "authoritative") {
			for (const relationship of existing) {
				const relatedEntityId =
					syncInput.direction === "outgoing"
						? relationship.targetEntityId
						: relationship.sourceEntityId;
				if (entries.has(relatedEntityId)) {
					continue;
				}

				yield* relationships
					.delete({
						scope: "global",
						sourceEntityId: relationship.sourceEntityId,
						targetEntityId: relationship.targetEntityId,
						relationshipSchemaId: relationship.relationshipSchemaId,
					})
					.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
			}
		}
	});

	const processedChildren: ProcessedChildEntity[] = [];
	for (const childEntity of input.childEntities) {
		const entitySchema = yield* runWithDb(
			entitySchemasRepository.getBuiltinBySlug(childEntity.entitySchemaSlug),
		).pipe(dieOnDbError);
		if (!entitySchema) {
			return yield* new SandboxRunError({
				message: `Child entity schema not found: ${childEntity.entitySchemaSlug}`,
			});
		}

		const populatedAt = yield* DateTime.nowAsDate;
		const entity = yield* entities
			.upsert({
				populatedAt,
				name: childEntity.name,
				entitySchemaId: entitySchema.id,
				externalId: childEntity.externalId,
				properties: childEntity.properties,
				sandboxScriptId: input.sandboxScriptId,
				updateExisting: input.syncExisting ?? false,
			})
			.pipe(
				dieOnDbError,
				Effect.mapError((error) => new SandboxRunError({ message: error.message })),
			);
		processedChildren.push({ entity, entitySchemaId: entitySchema.id });
	}

	const childEntitySchemaId = processedChildren[0]?.entitySchemaId;
	const relationshipSchema = yield* findChildRelationshipSchema(
		input.parentEntitySchemaId,
		input.parentEntitySchemaSlug,
		childEntitySchemaId,
	);
	if (relationshipSchema) {
		yield* synchronizeGlobalRelationships({
			direction: "outgoing",
			onConflict: "preserveExisting",
			synchronization: "authoritative",
			anchorEntityId: input.parentEntityId,
			relationshipSchemaId: relationshipSchema.id,
			propertiesSchema: relationshipSchema.propertiesSchema,
			entries: processedChildren.map((child) => ({ properties: {}, entityId: child.entity.id })),
		});
	}

	return processedChildren;
});
