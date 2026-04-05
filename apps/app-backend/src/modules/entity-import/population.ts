import { SandboxRunError, mapDbErrorToSandbox } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type { SandboxExecutionError } from "@ryot/contract/modules/sandbox/schemas";
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
	childEntitySchemaSlugs?: Readonly<Record<string, string>> | undefined;
}) {
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const entitySchemasRepository = yield* EntitySchemasRepository;
	const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

	const findChildRelationshipSchema = Effect.fn("findChildRelationshipSchema")(function* (
		sourceEntitySchemaSlug: EntitySchemaSlug,
		targetEntitySchemaSlug: EntitySchemaSlug | undefined,
	) {
		let targetSchemaId = targetEntitySchemaSlug;
		if (!targetSchemaId) {
			const targetSchemaSlug = input.childEntitySchemaSlugs?.[sourceEntitySchemaSlug];
			if (targetSchemaSlug) {
				const targetSchema = yield* runWithDb(
					entitySchemasRepository.getBuiltinBySlug(targetSchemaSlug),
				).pipe(mapDbErrorToSandbox);
				targetSchemaId = targetSchema?.id;
			}
		}
		if (!targetSchemaId) {
			return null;
		}
		const relationshipSchema = yield* runWithDb(
			relationshipSchemasRepository.findGlobalBySchemaIds({
				sourceEntitySchemaSlug,
				targetEntitySchemaSlug: targetSchemaId,
			}),
		).pipe(mapDbErrorToSandbox);
		if (!relationshipSchema && targetEntitySchemaSlug) {
			return yield* new SandboxRunError({
				message: `Child relationship schema not found: ${sourceEntitySchemaSlug} -> ${targetEntitySchemaSlug}`,
			});
		}
		return relationshipSchema;
	});

	const processedChildren: ProcessedChildEntity[] = [];
	for (const childEntity of input.childEntities) {
		const entitySchema = yield* runWithDb(
			entitySchemasRepository.getBuiltinBySlug(childEntity.entitySchemaSlug),
		).pipe(mapDbErrorToSandbox);
		if (!entitySchema) {
			return yield* new SandboxRunError({
				message: `Child entity schema not found: ${childEntity.entitySchemaSlug}`,
			});
		}

		const populatedAt = yield* DateTime.nowAsDate;
		const saved = yield* entities
			.upsert({
				populatedAt,
				name: childEntity.name,
				providerId: input.providerId,
				entitySchemaSlug: entitySchema.id,
				externalId: childEntity.externalId,
				properties: childEntity.properties,
				updateExisting: input.syncExisting ?? false,
			})
			.pipe(mapDbErrorToSandbox);
		processedChildren.push({
			entity: saved.entity,
			entityOutcome: saved.outcome,
			entitySchemaSlug: entitySchema.id,
		});
	}

	let relationshipOutcomes: RelationshipMutationOutcome[] = [];
	const childEntitySchemaSlug = processedChildren[0]?.entitySchemaSlug;
	const relationshipSchema = yield* findChildRelationshipSchema(
		input.parentEntitySchemaSlug,
		childEntitySchemaSlug,
	);
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
