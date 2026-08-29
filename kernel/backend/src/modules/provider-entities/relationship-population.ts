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
import { Effect, Option } from "effect";

import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import {
	RelationshipSchemasRepository,
	type RelationshipSchemaScope,
} from "#modules/relationship-schemas/repository";

import { synchronizeGlobalRelationships } from "./relationship-synchronization";

export const syncRelatedEntityGroup = Effect.fn("syncRelatedEntityGroup")(function* (
	input: {
		primaryEntityId: EntityId;
		primaryEntitySchemaSlug: EntitySchemaSlug;
		group: ProviderDetailsRelatedEntityGroup;
	} & ({ scope?: "global" } | { scope: "user"; userId: UserId }),
) {
	const entities = yield* EntitiesService;
	const repository = yield* EntitiesRepository;
	const relationshipSchemasRepository = yield* RelationshipSchemasRepository;
	const pluginRuntime = Option.getOrUndefined(yield* Effect.serviceOption(PluginRuntimeResolver));

	const effective =
		input.scope === "user" && pluginRuntime
			? yield* pluginRuntime.getEffectiveDefinitions(input.userId).pipe(mapDbErrorToSandbox)
			: null;
	const relationshipDefinition = effective?.relationshipSchemas[input.group.relationshipSchemaSlug];
	let relationshipSchema: RelationshipSchemaScope | null = relationshipDefinition
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
	if (!effective) {
		relationshipSchema = yield* relationshipSchemasRepository
			.findBuiltinBySlug(input.group.relationshipSchemaSlug)
			.pipe(mapDbErrorToSandbox);
	}
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
			input.scope === "user" && pluginRuntime
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
					? { scope: "user" as const, userId: input.userId }
					: { scope: "global" as const, populatedAt: null }),
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
		relationshipSchemaPluginId: relationshipSchema.pluginId ?? null,
		propertiesSchema: relationshipSchema.propertiesSchema,
		...(input.scope === "user"
			? { scope: "user" as const, userId: input.userId }
			: { scope: "global" as const }),
	});
}, dieOnDbError);
