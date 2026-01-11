import { SandboxRunError, dieOnDbError, mapDbErrorToSandbox } from "@ryot/contract/errors";
import type { EntityId, EntitySchemaSlug } from "@ryot/contract/schema/brands";
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

import { synchronizeGlobalRelationships } from "./relationship-synchronization";

export const syncRelatedEntityGroup = Effect.fn("syncRelatedEntityGroup")(function* (input: {
	primaryEntityId: EntityId;
	primaryEntitySchemaSlug: EntitySchemaSlug;
	group: ProviderDetailsRelatedEntityGroup;
}) {
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const repository = yield* EntitiesRepository;
	const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

	const relationshipSchema = yield* runWithDb(
		relationshipSchemasRepository.findBuiltinBySlug(input.group.relationshipSchemaSlug),
	).pipe(mapDbErrorToSandbox);
	if (!relationshipSchema) {
		return yield* new SandboxRunError({
			message: `Relationship schema not found: ${input.group.relationshipSchemaSlug}`,
		});
	}

	const entries: Array<{ entityId: EntityId; properties: Record<string, unknown> }> = [];
	const uniqueRelatedEntities = new Map<string, ProviderDetailsRelatedEntity>();
	for (const relatedEntity of input.group.entities) {
		uniqueRelatedEntities.set(
			`${relatedEntity.providerSlug}:${relatedEntity.externalId}`,
			relatedEntity,
		);
	}

	for (const relatedEntity of uniqueRelatedEntities.values()) {
		const schemaProvider = yield* runWithDb(
			repository.findEntitySchemaProviderBySlug(relatedEntity.providerSlug),
		).pipe(mapDbErrorToSandbox);
		if (!schemaProvider) {
			continue;
		}
		const entity = yield* entities
			.create({
				properties: {},
				scope: "global",
				populatedAt: null,
				name: relatedEntity.name,
				externalId: relatedEntity.externalId,
				providerId: schemaProvider.providerId,
				entitySchemaSlug: schemaProvider.entitySchemaSlug,
			})
			.pipe(mapDbErrorToSandbox);

		const sourceSchemaId =
			input.group.direction === "outgoing"
				? input.primaryEntitySchemaSlug
				: schemaProvider.entitySchemaSlug;
		const targetSchemaId =
			input.group.direction === "outgoing"
				? schemaProvider.entitySchemaSlug
				: input.primaryEntitySchemaSlug;

		if (
			relationshipSchema.sourceEntitySchemaSlug &&
			relationshipSchema.sourceEntitySchemaSlug !== sourceSchemaId
		) {
			return yield* new SandboxRunError({
				message: `Relationship source schema does not match ${input.group.relationshipSchemaSlug}`,
			});
		}
		if (
			relationshipSchema.targetEntitySchemaSlug &&
			relationshipSchema.targetEntitySchemaSlug !== targetSchemaId
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
		relationshipSchemaSlug: relationshipSchema.id,
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

	return yield* synchronizeGlobalRelationships({
		...syncInput,
		propertiesSchema: relationshipSchema.propertiesSchema,
	});
}, dieOnDbError);
