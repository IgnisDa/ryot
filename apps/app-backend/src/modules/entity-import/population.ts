import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { EntitySchemaId, type EntityId, type SandboxScriptId } from "@ryot/contract/schema/brands";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/db/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

export const EntityDetailsRelatedEntity = Schema.Struct({
	name: Schema.String,
	externalId: Schema.String,
	scriptSlug: Schema.String,
	reverseDirection: Schema.optional(Schema.Boolean),
	relationshipSchemaSlug: Schema.optional(Schema.String),
	relationshipProperties: Schema.optional(Schema.Unknown),
});

export type EntityDetailsRelatedEntity = typeof EntityDetailsRelatedEntity.Type;

export type EntityDetailsChildEntity = {
	name: string;
	externalId: string;
	properties: unknown;
	entitySchemaSlug: string;
	childEntities?: ReadonlyArray<EntityDetailsChildEntity>;
};

type EncodedEntityDetailsChildEntity = {
	readonly name: string;
	readonly externalId: string;
	readonly properties: unknown;
	readonly entitySchemaSlug: string;
	readonly childEntities?: ReadonlyArray<EncodedEntityDetailsChildEntity>;
};

export const EntityDetailsChildEntity: Schema.Schema<
	EntityDetailsChildEntity,
	EncodedEntityDetailsChildEntity
> = Schema.suspend(() =>
	Schema.Struct({
		name: Schema.String,
		externalId: Schema.String,
		properties: Schema.Unknown,
		entitySchemaSlug: Schema.String,
		childEntities: Schema.optional(Schema.Array(EntityDetailsChildEntity)),
	}),
).annotations({ identifier: "EntityDetailsChildEntity" });

const EntityDetailsResult = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	childEntities: Schema.optional(Schema.Array(EntityDetailsChildEntity)),
	relatedEntities: Schema.optional(Schema.Array(EntityDetailsRelatedEntity)),
});

export const decodeEntityDetailsResult = Schema.decodeUnknown(EntityDetailsResult);

const EntityResolveResult = Schema.Struct({ externalId: Schema.NullOr(Schema.String) });

export const decodeEntityResolveResult = Schema.decodeUnknown(EntityResolveResult);

const EntitySearchItem = Schema.Struct({
	externalId: Schema.NonEmptyString,
	titleProperty: Schema.Struct({ value: Schema.NonEmptyString, kind: Schema.Literal("text") }),
	primarySubtitleProperty: Schema.optional(
		Schema.Union(
			Schema.Struct({ kind: Schema.Literal("null"), value: Schema.Null }).pipe(
				Schema.annotations({ identifier: "NullSubtitleProperty", title: "Null Subtitle Property" }),
			),
			Schema.Struct({ kind: Schema.Literal("number"), value: Schema.Number }).pipe(
				Schema.annotations({
					title: "Number Subtitle Property",
					identifier: "NumberSubtitleProperty",
				}),
			),
		),
	),
});

export type EntitySearchItem = typeof EntitySearchItem.Type;

const EntitySearchResult = Schema.Struct({ items: Schema.Array(EntitySearchItem) });

export const decodeEntitySearchResult = Schema.decodeUnknown(EntitySearchResult);

export const decodeSandboxDriverResult = <A, E, R>(
	result: { error: string | null; value: unknown },
	decode: (input: unknown) => Effect.Effect<A, E, R>,
	errorMessage: string,
): Effect.Effect<A, SandboxRunError, R> =>
	result.error
		? Effect.fail(new SandboxRunError({ message: result.error }))
		: decode(result.value).pipe(
				Effect.mapError(() => new SandboxRunError({ message: errorMessage })),
			);

const ProcessedChildEntity = Schema.Struct({
	entity: ListedEntity,
	entitySchemaId: EntitySchemaId,
});

export const processChildEntityTree = Effect.fn("processChildEntityTree")(function* (input: {
	activityPrefix: string;
	parentEntityId: EntityId;
	sandboxScriptId: SandboxScriptId;
	parentEntitySchemaId: EntitySchemaId;
	childEntities: ReadonlyArray<EntityDetailsChildEntity>;
}) {
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const relationships = yield* RelationshipsService;
	const entitySchemasRepository = yield* EntitySchemasRepository;
	const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

	const processNode = (
		childEntity: EntityDetailsChildEntity,
		parentEntityId: EntityId,
		parentEntitySchemaId: EntitySchemaId,
		path: string,
	): Effect.Effect<void, SandboxRunError, WorkflowEngine | WorkflowInstance> =>
		Effect.gen(function* () {
			const child = yield* Activity.make({
				error: SandboxRunError,
				success: ProcessedChildEntity,
				name: `${input.activityPrefix}write-child-entity-${path}-${childEntity.entitySchemaSlug}-${childEntity.externalId}`,
				execute: Effect.gen(function* () {
					const entitySchema = yield* runWithDb(
						entitySchemasRepository.getBuiltinBySlug(childEntity.entitySchemaSlug),
					).pipe(dieOnDbError);
					if (!entitySchema) {
						return yield* new SandboxRunError({
							message: `Child entity schema not found: ${childEntity.entitySchemaSlug}`,
						});
					}

					const populatedAt = yield* DateTime.nowAsDate;
					const entity = yield* entities
						.save({
							populatedAt,
							scope: "global",
							name: childEntity.name,
							entitySchemaId: entitySchema.id,
							externalId: childEntity.externalId,
							properties: childEntity.properties,
							sandboxScriptId: input.sandboxScriptId,
						})
						.pipe(
							dieOnDbError,
							Effect.mapError((error) => new SandboxRunError({ message: error.message })),
						);

					return { entity, entitySchemaId: entitySchema.id };
				}),
			});

			yield* Activity.make({
				error: SandboxRunError,
				name: `${input.activityPrefix}write-child-relationship-${path}-${childEntity.entitySchemaSlug}-${childEntity.externalId}`,
				execute: Effect.gen(function* () {
					const relationshipSchema = yield* runWithDb(
						relationshipSchemasRepository.findGlobalBySchemaIds({
							sourceEntitySchemaId: parentEntitySchemaId,
							targetEntitySchemaId: child.entitySchemaId,
						}),
					).pipe(dieOnDbError);
					if (!relationshipSchema) {
						return yield* new SandboxRunError({
							message: `Child relationship schema not found: ${parentEntitySchemaId} -> ${child.entitySchemaId}`,
						});
					}

					yield* relationships
						.create({
							properties: {},
							scope: "global",
							sourceEntityId: parentEntityId,
							targetEntityId: child.entity.id,
							onConflict: "replaceProperties",
							relationshipSchemaId: relationshipSchema.id,
							propertiesSchema: relationshipSchema.propertiesSchema,
						})
						.pipe(
							dieOnDbError,
							Effect.mapError((error) => new SandboxRunError({ message: error.message })),
						);
					return undefined;
				}),
			});

			for (const [index, nestedChildEntity] of (childEntity.childEntities ?? []).entries()) {
				yield* processNode(
					nestedChildEntity,
					child.entity.id,
					child.entitySchemaId,
					`${path}-${index}`,
				);
			}
		});

	for (const [index, childEntity] of input.childEntities.entries()) {
		yield* processNode(
			childEntity,
			input.parentEntityId,
			input.parentEntitySchemaId,
			String(index),
		);
	}
});

export const processRelatedEntity = Effect.fn("processRelatedEntity")(function* (input: {
	sourceEntityId: EntityId;
	sourceEntitySchemaId: EntitySchemaId;
	relatedEntity: EntityDetailsRelatedEntity;
}) {
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const repository = yield* EntitiesRepository;
	const relationships = yield* RelationshipsService;
	const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

	const entitySchemaSandboxScript = yield* runWithDb(
		repository.findEntitySchemaSandboxScriptBySlug(input.relatedEntity.scriptSlug),
	);
	if (!entitySchemaSandboxScript) {
		return;
	}

	const relatedEntity = yield* entities
		.save({
			properties: {},
			scope: "global",
			populatedAt: null,
			name: input.relatedEntity.name,
			externalId: input.relatedEntity.externalId,
			entitySchemaId: entitySchemaSandboxScript.entitySchemaId,
			sandboxScriptId: entitySchemaSandboxScript.sandboxScriptId,
		})
		.pipe(
			dieOnDbError,
			Effect.mapError((error) => new SandboxRunError({ message: error.message })),
		);

	const { reverseDirection } = input.relatedEntity;
	const sourceEntityId = reverseDirection ? input.sourceEntityId : relatedEntity.id;
	const targetEntityId = reverseDirection ? relatedEntity.id : input.sourceEntityId;
	const sourceSchemaId = reverseDirection
		? input.sourceEntitySchemaId
		: entitySchemaSandboxScript.entitySchemaId;
	const targetSchemaId = reverseDirection
		? entitySchemaSandboxScript.entitySchemaId
		: input.sourceEntitySchemaId;

	const relationshipSchema = yield* runWithDb(
		relationshipSchemasRepository.findGlobalBySchemaIds({
			sourceEntitySchemaId: sourceSchemaId,
			targetEntitySchemaId: targetSchemaId,
		}),
	);
	if (!relationshipSchema) {
		return;
	}

	const relProps = input.relatedEntity.relationshipProperties;
	yield* relationships
		.create({
			sourceEntityId,
			targetEntityId,
			scope: "global",
			onConflict: "replaceProperties",
			relationshipSchemaId: relationshipSchema.id,
			properties: relProps === undefined ? {} : relProps,
			propertiesSchema: relationshipSchema.propertiesSchema,
		})
		.pipe(
			dieOnDbError,
			Effect.mapError((error) => new SandboxRunError({ message: error.message })),
		);
}, dieOnDbError);

export const syncRelatedEntitiesByRelationshipSchema = Effect.fn(
	"syncRelatedEntitiesByRelationshipSchema",
)(function* (input: {
	sourceEntityId: EntityId;
	relationshipSchemaSlug: string;
	relatedEntities: ReadonlyArray<EntityDetailsRelatedEntity>;
}) {
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const repository = yield* EntitiesRepository;
	const relationshipsRepository = yield* RelationshipsRepository;
	const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

	const relationshipSchema = yield* runWithDb(
		relationshipSchemasRepository.findBuiltinBySlug(input.relationshipSchemaSlug),
	).pipe(dieOnDbError);
	if (!relationshipSchema) {
		return yield* new SandboxRunError({
			message: `Relationship schema not found: ${input.relationshipSchemaSlug}`,
		});
	}

	const uniqueRelatedEntities = new Map<string, EntityDetailsRelatedEntity>();
	for (const relatedEntity of input.relatedEntities) {
		uniqueRelatedEntities.set(
			`${relatedEntity.scriptSlug}:${relatedEntity.externalId}`,
			relatedEntity,
		);
	}

	const targetEntityIds: EntityId[] = [];
	for (const relatedEntity of uniqueRelatedEntities.values()) {
		const entitySchemaSandboxScript = yield* runWithDb(
			repository.findEntitySchemaSandboxScriptBySlug(relatedEntity.scriptSlug),
		).pipe(dieOnDbError);
		if (!entitySchemaSandboxScript) {
			continue;
		}

		const entity = yield* entities
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

		targetEntityIds.push(entity.id);
	}

	yield* runWithDb(
		relationshipsRepository.syncGlobalRelationshipTargets({
			targetEntityIds,
			sourceEntityId: input.sourceEntityId,
			relationshipSchemaId: relationshipSchema.id,
		}),
	).pipe(dieOnDbError);

	return undefined;
}, dieOnDbError);
