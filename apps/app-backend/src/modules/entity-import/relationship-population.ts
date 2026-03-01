import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import type { EntityId, EntitySchemaId } from "@ryot/contract/schema/brands";
import type {
	ProviderDetailsRelatedEntity,
	ProviderDetailsRelatedEntityGroup,
} from "@ryot/sandbox-sdk/provider";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

export const syncRelatedEntityGroup = Effect.fn("syncRelatedEntityGroup")(function* (input: {
	primaryEntityId: EntityId;
	primaryEntitySchemaId: EntitySchemaId;
	group: ProviderDetailsRelatedEntityGroup;
}) {
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const repository = yield* EntitiesRepository;
	const relationships = yield* RelationshipsService;
	const relationshipsRepository = yield* RelationshipsRepository;
	const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

	const relationshipSchema = yield* runWithDb(
		relationshipSchemasRepository.findBuiltinBySlug(input.group.relationshipSchemaSlug),
	).pipe(dieOnDbError);
	if (!relationshipSchema) {
		return yield* new SandboxRunError({
			message: `Relationship schema not found: ${input.group.relationshipSchemaSlug}`,
		});
	}

	const entries: Array<{ entityId: EntityId; properties: Record<string, unknown> }> = [];
	const uniqueRelatedEntities = new Map<string, ProviderDetailsRelatedEntity>();
	for (const relatedEntity of input.group.entities) {
		uniqueRelatedEntities.set(
			`${relatedEntity.scriptSlug}:${relatedEntity.externalId}`,
			relatedEntity,
		);
	}

	for (const relatedEntity of uniqueRelatedEntities.values()) {
		const entitySchemaSandboxScript = yield* runWithDb(
			repository.findEntitySchemaSandboxScriptBySlug(relatedEntity.scriptSlug),
		).pipe(dieOnDbError);
		if (!entitySchemaSandboxScript) {
			continue;
		}

		const entity = yield* entities
			.create({
				properties: {},
				scope: "global",
				populatedAt: null,
				name: relatedEntity.name,
				externalId: relatedEntity.externalId,
				entitySchemaId: entitySchemaSandboxScript.entitySchemaId,
				sandboxScriptId: entitySchemaSandboxScript.sandboxScriptId,
			})
			.pipe(
				dieOnDbError,
				Effect.mapError((error) => new SandboxRunError({ message: error.message })),
			);

		const sourceSchemaId =
			input.group.direction === "outgoing"
				? input.primaryEntitySchemaId
				: entitySchemaSandboxScript.entitySchemaId;
		const targetSchemaId =
			input.group.direction === "outgoing"
				? entitySchemaSandboxScript.entitySchemaId
				: input.primaryEntitySchemaId;

		if (
			relationshipSchema.sourceEntitySchemaId &&
			relationshipSchema.sourceEntitySchemaId !== sourceSchemaId
		) {
			return yield* new SandboxRunError({
				message: `Relationship source schema does not match ${input.group.relationshipSchemaSlug}`,
			});
		}
		if (
			relationshipSchema.targetEntitySchemaId &&
			relationshipSchema.targetEntitySchemaId !== targetSchemaId
		) {
			return yield* new SandboxRunError({
				message: `Relationship target schema does not match ${input.group.relationshipSchemaSlug}`,
			});
		}

		const properties = yield* parseAppSchemaProperties({
			kind: "Relationship",
			properties: relatedEntity.relationshipProperties ?? {},
			propertiesSchema: relationshipSchema.propertiesSchema,
		}).pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));

		entries.push({ entityId: entity.id, properties });
	}

	const syncBase = {
		type: "anchored" as const,
		entries,
		direction: input.group.direction,
		anchorEntityId: input.primaryEntityId,
		relationshipSchemaId: relationshipSchema.id,
	};
	const syncInput =
		input.group.synchronization === "additive"
			? {
					...syncBase,
					onConflict: "preserveExisting" as const,
					synchronization: "additive" as const,
				}
			: {
					...syncBase,
					onConflict: "replaceProperties" as const,
					synchronization: "authoritative" as const,
				};

	const existing = yield* runWithDb(
		relationshipsRepository.listGlobalRelationships({
			type: "anchored",
			direction: syncInput.direction,
			anchorEntityId: syncInput.anchorEntityId,
			relationshipSchemaId: syncInput.relationshipSchemaId,
		}),
	);
	const existingByEntityId = new Map(
		existing.map((relationship) => [
			syncInput.direction === "outgoing"
				? relationship.targetEntityId
				: relationship.sourceEntityId,
			relationship,
		]),
	);
	const entriesByEntityId = new Map(syncInput.entries.map((entry) => [entry.entityId, entry]));
	for (const entry of entriesByEntityId.values()) {
		const sourceEntityId =
			syncInput.direction === "outgoing" ? syncInput.anchorEntityId : entry.entityId;
		const targetEntityId =
			syncInput.direction === "outgoing" ? entry.entityId : syncInput.anchorEntityId;
		const relationshipInput = {
			sourceEntityId,
			targetEntityId,
			scope: "global" as const,
			properties: entry.properties,
			relationshipSchemaId: syncInput.relationshipSchemaId,
			propertiesSchema: relationshipSchema.propertiesSchema,
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
			if (entriesByEntityId.has(relatedEntityId)) {
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
	return undefined;
}, dieOnDbError);
