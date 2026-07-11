import { SandboxRunError, mapDbErrorToSandbox } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import {
	EntitySchemaSlug,
	type EntityId,
	type SandboxProviderId,
} from "@ryot/contract/schema/brands";
import type { ProviderDetailsChildEntity } from "@ryot/sandbox-sdk/provider";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { EntityMutationOutcome } from "#modules/entities/mutation-outcomes";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
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

export const writeChildEntitySet = Effect.fn("writeChildEntitySet")(function* (input: {
	syncExisting?: boolean;
	parentEntityId: EntityId;
	providerId: SandboxProviderId;
	parentEntitySchemaSlug: EntitySchemaSlug;
	childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
	expectedChildEntitySchemaSlug?: string | undefined;
}) {
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const entitySchemasRepository = yield* EntitySchemasRepository;
	const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

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
		input.expectedChildEntitySchemaSlug &&
		rowChildEntitySchemaSlug &&
		input.expectedChildEntitySchemaSlug !== rowChildEntitySchemaSlug
	) {
		return yield* new SandboxRunError({
			message: `Child entity schema does not match declared schema: ${rowChildEntitySchemaSlug} !== ${input.expectedChildEntitySchemaSlug}`,
		});
	}
	const childEntitySchemaSlug = input.expectedChildEntitySchemaSlug ?? rowChildEntitySchemaSlug;
	const childEntitySchema = childEntitySchemaSlug
		? yield* runWithDb(entitySchemasRepository.getBuiltinBySlug(childEntitySchemaSlug)).pipe(
				mapDbErrorToSandbox,
			)
		: null;
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
		const relationshipSchema = yield* runWithDb(
			relationshipSchemasRepository.findGlobalBySchemaIds({
				sourceEntitySchemaSlug: input.parentEntitySchemaSlug,
				targetEntitySchemaSlug,
			}),
		).pipe(mapDbErrorToSandbox);
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
				entitySchemaSlug: childEntitySchema.id,
				externalId: childEntity.externalId,
				properties: childEntity.properties,
				updateExisting: input.syncExisting ?? false,
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
			entries: processedChildren.map((child) => ({ properties: {}, entityId: child.entity.id })),
		});
	}
	const now = yield* DateTime.nowAsDate;
	return {
		processedChildren,
		relationshipOutcomes,
		committedAt: now.toISOString(),
	} satisfies ChildEntitySetWriteResult;
});
