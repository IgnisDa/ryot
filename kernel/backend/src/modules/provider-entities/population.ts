import { SandboxRunError } from "@ryot-app/contract/errors";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import {
	EntitySchemaSlug,
	type EntityId,
	RelationshipSchemaSlug,
	type SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { ProviderDetailsChildEntity } from "@ryot-app/sandbox-sdk/provider";
import { DateTime, Effect, Schema } from "effect";

import type { DefinitionSnapshot } from "#modules/definition-registry/service";
import { EntityMutationOutcome } from "#modules/entities/mutation-outcomes";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
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
		definitions: DefinitionSnapshot;
		syncExisting?: boolean;
		parentEntityId: EntityId;
		providerId: SandboxProviderId;
		parentEntitySchemaSlug: EntitySchemaSlug;
		expectedChildEntitySchemaSlug?: string | undefined;
		childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
	} & ({ scope: "global" } | { scope: "user"; userId: UserId }),
) {
	const entities = yield* EntitiesService;
	const entitiesRepository = yield* EntitiesRepository;

	const childSchemaSlugs = new Set(
		input.childEntities.map(({ entitySchemaSlug }) => entitySchemaSlug),
	);
	if (childSchemaSlugs.size > 1) {
		return yield* new SandboxRunError({ message: "Child entities must use one entity schema" });
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
	if (childEntitySchemaSlug && input.definitions.entitySchemas[childEntitySchemaSlug]) {
		childEntitySchema = { id: EntitySchemaSlug.make(childEntitySchemaSlug) };
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
		const relationshipDefinition = Object.values(input.definitions.relationshipSchemas).find(
			(definition) =>
				definition.sourceEntitySchemaSlug === input.parentEntitySchemaSlug &&
				definition.targetEntitySchemaSlug === targetEntitySchemaSlug,
		);
		const relationshipSchema = relationshipDefinition
			? {
					pluginId: relationshipDefinition.pluginId ?? null,
					propertiesSchema: relationshipDefinition.propertiesSchema,
					id: RelationshipSchemaSlug.make(relationshipDefinition.slug),
				}
			: null;
		if (!relationshipSchema) {
			return yield* new SandboxRunError({
				message: `Child relationship schema not found: ${input.parentEntitySchemaSlug} -> ${targetEntitySchemaSlug}`,
			});
		}
		return relationshipSchema;
	});

	const orderedChildEntities = input.childEntities
		.map((childEntity, index) => ({ index, childEntity }))
		.sort((left, right) => left.childEntity.externalId.localeCompare(right.childEntity.externalId));
	if (childEntitySchema) {
		yield* entitiesRepository.lockProviderEntityMutations(
			orderedChildEntities.map(({ childEntity }) => ({
				providerId: input.providerId,
				externalId: childEntity.externalId,
				entitySchemaSlug: childEntitySchema.id,
				...(input.scope === "user"
					? { userId: input.userId, scope: "user" as const }
					: { scope: "global" as const }),
			})),
		);
	}

	const processedChildrenByIndex: Array<ProcessedChildEntity | undefined> = Array.from({
		length: input.childEntities.length,
	});
	for (const { index, childEntity } of orderedChildEntities) {
		if (!childEntitySchema) {
			return yield* Effect.die("Validated child schema is missing");
		}

		const populatedAt = yield* DateTime.nowAsDate;
		const saved = yield* entities.upsert({
			populatedAt,
			name: childEntity.name,
			providerId: input.providerId,
			externalId: childEntity.externalId,
			properties: childEntity.properties,
			entitySchemaSlug: childEntitySchema.id,
			updateExisting: input.syncExisting ?? false,
			...(input.scope === "user"
				? { userId: input.userId, scope: "user" as const }
				: { scope: "global" as const }),
		});
		processedChildrenByIndex[index] = {
			entity: saved.entity,
			entityOutcome: saved.outcome,
			entitySchemaSlug: childEntitySchema.id,
		};
	}
	const processedChildren = processedChildrenByIndex.flatMap((child) => (child ? [child] : []));

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
				? { userId: input.userId, scope: "user" as const }
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
