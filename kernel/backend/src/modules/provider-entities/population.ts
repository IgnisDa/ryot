import { SandboxRunError, mapDbErrorToSandbox } from "@ryot-app/contract/errors";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import {
	EntitySchemaSlug,
	type EntityId,
	RelationshipSchemaSlug,
	type SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { ProviderDetailsChildEntity } from "@ryot-app/sandbox-sdk/provider";
import { DateTime, Effect, Option, Schema } from "effect";

import { EntityMutationOutcome } from "#modules/entities/mutation-outcomes";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import {
	RelationshipMutationOutcomes,
	type RelationshipMutationOutcome,
} from "#modules/relationships/mutation-outcomes";

import { synchronizeGlobalRelationships } from "./relationship-synchronization";

export const ProcessedChildEntity = Schema.Struct({
	entity: ListedEntity,
	entitySchemaSlug: EntitySchemaSlug,
	entityOutcome: EntityMutationOutcome,
});

export type ProcessedChildEntity = typeof ProcessedChildEntity.Type;

export const ChildEntitySetWriteResult = Schema.Struct({
	committedAt: Schema.String,
	relationshipOutcomes: RelationshipMutationOutcomes,
	processedChildren: Schema.Array(ProcessedChildEntity),
});

export type ChildEntitySetWriteResult = typeof ChildEntitySetWriteResult.Type;

export const writeChildEntitySet = Effect.fn("writeChildEntitySet")(function* (
	input: {
		syncExisting?: boolean;
		parentEntityId: EntityId;
		providerId: SandboxProviderId;
		parentEntitySchemaSlug: EntitySchemaSlug;
		expectedChildEntitySchemaSlug?: string | undefined;
		childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
	} & ({ scope?: "global" } | { scope: "user"; userId: UserId }),
) {
	const entities = yield* EntitiesService;
	const entitySchemasRepository = yield* EntitySchemasRepository;
	const relationshipSchemasRepository = yield* RelationshipSchemasRepository;
	const pluginRuntime = Option.getOrUndefined(yield* Effect.serviceOption(PluginRuntimeResolver));
	const definitions =
		input.scope === "user" && pluginRuntime
			? yield* pluginRuntime.getEffectiveDefinitions(input.userId)
			: null;

	const childSchemaSlugs = new Set(
		input.childEntities.map(({ entitySchemaSlug }) => entitySchemaSlug),
	);
	if (childSchemaSlugs.size > 1) {
		return yield* new SandboxRunError({
			message: "Child entities must use one entity schema",
		});
	}
	const rowChildEntitySchemaSlug = input.childEntities[0]?.entitySchemaSlug;
	if (
		rowChildEntitySchemaSlug &&
		input.expectedChildEntitySchemaSlug &&
		input.expectedChildEntitySchemaSlug !== rowChildEntitySchemaSlug
	) {
		return yield* new SandboxRunError({
			message: `Child entity schema does not match declared schema: ${rowChildEntitySchemaSlug} !== ${input.expectedChildEntitySchemaSlug}`,
		});
	}
	const childEntitySchemaSlug = input.expectedChildEntitySchemaSlug ?? rowChildEntitySchemaSlug;
	let childEntitySchema: { id: EntitySchemaSlug } | null = null;
	if (childEntitySchemaSlug) {
		if (definitions) {
			childEntitySchema = definitions.entitySchemas[childEntitySchemaSlug]
				? { id: EntitySchemaSlug.make(childEntitySchemaSlug) }
				: null;
		} else {
			childEntitySchema = yield* entitySchemasRepository
				.getBuiltinBySlug(childEntitySchemaSlug)
				.pipe(mapDbErrorToSandbox);
		}
	}
	if (childEntitySchemaSlug && !childEntitySchema) {
		return yield* new SandboxRunError({
			message: `Child entity schema not found: ${childEntitySchemaSlug}`,
		});
	}

	const findChildRelationshipSchema = Effect.fn("findChildRelationshipSchema")(function* (
		targetEntitySchemaSlug: EntitySchemaSlug | undefined,
	) {
		if (!targetEntitySchemaSlug) {
			return null;
		}
		const relationshipDefinition = definitions
			? Object.values(definitions.relationshipSchemas).find(
					(definition) =>
						definition.sourceEntitySchemaSlug === input.parentEntitySchemaSlug &&
						definition.targetEntitySchemaSlug === targetEntitySchemaSlug,
				)
			: null;
		let relationshipSchema = relationshipDefinition
			? {
					pluginId: relationshipDefinition.pluginId ?? null,
					propertiesSchema: relationshipDefinition.propertiesSchema,
					id: RelationshipSchemaSlug.make(relationshipDefinition.slug),
				}
			: null;
		if (!definitions) {
			const globalSchema = yield* relationshipSchemasRepository
				.findGlobalBySchemaIds({
					targetEntitySchemaSlug,
					sourceEntitySchemaSlug: input.parentEntitySchemaSlug,
				})
				.pipe(mapDbErrorToSandbox);
			relationshipSchema = globalSchema
				? {
						id: globalSchema.id,
						pluginId: globalSchema.pluginId ?? null,
						propertiesSchema: globalSchema.propertiesSchema,
					}
				: null;
		}
		if (!relationshipSchema) {
			return yield* new SandboxRunError({
				message: `Child relationship schema not found: ${input.parentEntitySchemaSlug} -> ${targetEntitySchemaSlug}`,
			});
		}
		return relationshipSchema;
	});

	const processedChildren: ProcessedChildEntity[] = [];
	for (const childEntity of input.childEntities) {
		if (!childEntitySchema) {
			return yield* Effect.die("Validated child schema is missing");
		}

		const populatedAt = yield* DateTime.nowAsDate;
		const saved = yield* entities
			.upsert({
				populatedAt,
				name: childEntity.name,
				providerId: input.providerId,
				externalId: childEntity.externalId,
				properties: childEntity.properties,
				entitySchemaSlug: childEntitySchema.id,
				updateExisting: input.syncExisting ?? false,
				...(input.scope === "user"
					? { scope: "user" as const, userId: input.userId }
					: { scope: "global" as const }),
			})
			.pipe(mapDbErrorToSandbox);
		processedChildren.push({
			entity: saved.entity,
			entityOutcome: saved.outcome,
			entitySchemaSlug: childEntitySchema.id,
		});
	}

	let relationshipOutcomes: RelationshipMutationOutcome[] = [];
	const relationshipSchema = yield* findChildRelationshipSchema(childEntitySchema?.id);
	if (relationshipSchema) {
		relationshipOutcomes = yield* synchronizeGlobalRelationships({
			direction: "outgoing",
			onConflict: "preserveExisting",
			synchronization: "authoritative",
			anchorEntityId: input.parentEntityId,
			relationshipSchemaSlug: relationshipSchema.id,
			propertiesSchema: relationshipSchema.propertiesSchema,
			relationshipSchemaPluginId: relationshipSchema.pluginId,
			entries: processedChildren.map((child) => ({ properties: {}, entityId: child.entity.id })),
			...(input.scope === "user"
				? { scope: "user" as const, userId: input.userId }
				: { scope: "global" as const }),
		});
	}
	const now = yield* DateTime.nowAsDate;
	return {
		processedChildren,
		relationshipOutcomes,
		committedAt: now.toISOString(),
	} satisfies ChildEntitySetWriteResult;
});
