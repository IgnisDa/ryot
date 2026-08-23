import { SandboxRunError, dieOnDbError, mapDbErrorToSandbox } from "@ryot-app/contract/errors";
import {
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	type EntityId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type {
	ProviderDetailsRelatedEntity,
	ProviderDetailsRelatedEntityGroup,
} from "@ryot-app/sandbox-sdk/provider";
import { Effect } from "effect";

import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import type { DefinitionSnapshot } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { synchronizeGlobalRelationships } from "./relationship-synchronization";

export const syncRelatedEntityGroup = Effect.fn("syncRelatedEntityGroup")(function* (
	input: {
		definitions: DefinitionSnapshot;
		primaryEntityId: EntityId;
		primaryEntitySchemaSlug: EntitySchemaSlug;
		group: ProviderDetailsRelatedEntityGroup;
	} & ({ scope: "global" } | { scope: "user"; userId: UserId }),
) {
	const entities = yield* EntitiesService;
	const repository = yield* EntitiesRepository;
	const pluginRuntime = yield* PluginRuntimeResolver;
	const relationshipDefinition =
		input.definitions.relationshipSchemas[input.group.relationshipSchemaSlug];
	const relationshipSchema = relationshipDefinition
		? ({
				isBuiltin: true,
				name: relationshipDefinition.name,
				slug: relationshipDefinition.slug,
				pluginId: relationshipDefinition.pluginId ?? null,
				propertiesSchema: relationshipDefinition.propertiesSchema,
				id: RelationshipSchemaSlug.make(relationshipDefinition.slug),
				sourceEntitySchemaSlug: relationshipDefinition.sourceEntitySchemaSlug
					? EntitySchemaSlug.make(relationshipDefinition.sourceEntitySchemaSlug)
					: null,
				targetEntitySchemaSlug: relationshipDefinition.targetEntitySchemaSlug
					? EntitySchemaSlug.make(relationshipDefinition.targetEntitySchemaSlug)
					: null,
			} as const)
		: null;
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
		const availableProvider =
			input.scope === "user"
				? yield* pluginRuntime
						.findProviderAvailableToUserBySlug(input.userId, relatedEntity.providerSlug)
						.pipe(mapDbErrorToSandbox)
				: null;
		const persistedSchemaProvider =
			input.scope === "global"
				? yield* repository
						.findEntitySchemaProviderBySlug(relatedEntity.providerSlug)
						.pipe(mapDbErrorToSandbox)
				: null;
		const schemaProvider = availableProvider
			? ({
					providerId: availableProvider.id,
					entitySchemaSlug: EntitySchemaSlug.make(availableProvider.rootEntitySchemaSlug),
				} as const)
			: persistedSchemaProvider;
		if (!schemaProvider) {
			continue;
		}
		const entity = yield* entities
			.create({
				properties: {},
				name: relatedEntity.name,
				externalId: relatedEntity.externalId,
				providerId: schemaProvider.providerId,
				entitySchemaSlug: schemaProvider.entitySchemaSlug,
				...(input.scope === "user"
					? { userId: input.userId, scope: "user" as const }
					: { populatedAt: null, scope: "global" as const }),
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
			propertiesSchema: relationshipSchema.propertiesSchema,
			properties: relatedEntity.relationshipProperties ?? {},
		}).pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));

		entries.push({ properties, entityId: entity.id });
	}

	const syncBase = {
		entries,
		type: "anchored" as const,
		direction: input.group.direction,
		anchorEntityId: input.primaryEntityId,
		relationshipSchemaSlug: relationshipSchema.id,
	};
	const syncInput =
		input.group.synchronization === "additive"
			? {
					...syncBase,
					synchronization: "additive" as const,
					onConflict: "preserveExisting" as const,
				}
			: {
					...syncBase,
					onConflict: "replaceProperties" as const,
					synchronization: "authoritative" as const,
				};

	return yield* synchronizeGlobalRelationships({
		...syncInput,
		propertiesSchema: relationshipSchema.propertiesSchema,
		relationshipSchemaPluginId: relationshipSchema.pluginId ?? null,
		...(input.scope === "user"
			? { userId: input.userId, scope: "user" as const }
			: { scope: "global" as const }),
	});
}, dieOnDbError);
