import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import type { EntityId, EntitySchemaId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";

import type {
	EntityDetailsRelatedEntity,
	EntityDetailsRelationshipGroup,
	PopulationEntityMutation,
} from "./population";

export const syncRelatedEntityGroup = Effect.fn("syncRelatedEntityGroup")(function* (input: {
	primaryEntityId: EntityId;
	primaryEntitySchemaId: EntitySchemaId;
	group: EntityDetailsRelationshipGroup;
}) {
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const repository = yield* EntitiesRepository;
	const relationshipsService = yield* RelationshipsService;
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
	const relatedEntityMutations: Array<PopulationEntityMutation> = [];
	const uniqueRelatedEntities = new Map<string, EntityDetailsRelatedEntity>();
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

		const outcome = yield* entities
			.save({
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
		relatedEntityMutations.push({
			outcome,
			entitySchemaSlug: entitySchemaSandboxScript.entitySchemaSlug,
		});
		const entity = outcome.entity;

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

	const outcome = yield* relationshipsService.syncGlobal(syncInput).pipe(dieOnDbError);
	return { outcome, relationshipSchemaId: relationshipSchema.id, relatedEntityMutations };
}, dieOnDbError);
