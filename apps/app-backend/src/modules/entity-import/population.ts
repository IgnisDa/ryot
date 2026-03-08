import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type { SandboxExecutionError } from "@ryot/contract/modules/sandbox/schemas";
import { EntitySchemaId, type EntityId, type SandboxScriptId } from "@ryot/contract/schema/brands";
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
	entitySchemaId: EntitySchemaId,
	entityOutcome: EntityMutationOutcome,
});

export type ProcessedChildEntity = typeof ProcessedChildEntity.Type;

export const ChildEntitySetWriteResult = Schema.Struct({
	relationshipOutcomes: RelationshipMutationOutcomes,
	processedChildren: Schema.Array(ProcessedChildEntity),
});

export type ChildEntitySetWriteResult = typeof ChildEntitySetWriteResult.Type;

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
		const saved = yield* entities
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
		processedChildren.push({
			entity: saved.entity,
			entityOutcome: saved.outcome,
			entitySchemaId: entitySchema.id,
		});
	}

	let relationshipOutcomes: RelationshipMutationOutcome[] = [];
	const childEntitySchemaId = processedChildren[0]?.entitySchemaId;
	const relationshipSchema = yield* findChildRelationshipSchema(
		input.parentEntitySchemaId,
		input.parentEntitySchemaSlug,
		childEntitySchemaId,
	);
	if (relationshipSchema) {
		relationshipOutcomes = yield* synchronizeGlobalRelationships({
			direction: "outgoing",
			onConflict: "preserveExisting",
			synchronization: "authoritative",
			anchorEntityId: input.parentEntityId,
			relationshipSchemaId: relationshipSchema.id,
			relationshipSchemaSlug: relationshipSchema.slug,
			propertiesSchema: relationshipSchema.propertiesSchema,
			entries: processedChildren.map((child) => ({ properties: {}, entityId: child.entity.id })),
		});
	}

	return { processedChildren, relationshipOutcomes } satisfies ChildEntitySetWriteResult;
});
