import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { DateTime, Effect, Schema } from "effect";

import { builtinEntitySchemas } from "#lib/builtins/entity-schemas";
import { DbRunner } from "#lib/db";
import { SandboxRunError, dieOnDbError } from "#lib/errors";
import { EntitySchemaId, type EntityId, type SandboxScriptId } from "#lib/schema/brands";
import { parseAppSchemaProperties } from "#lib/schema/property-schema-runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntityImage, ListedEntity } from "#modules/entities/schemas";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

export const EntityDetailsRelatedEntity = Schema.Struct({
	name: Schema.String,
	externalId: Schema.String,
	scriptSlug: Schema.String,
	reverseDirection: Schema.optional(Schema.Boolean),
	relationshipProperties: Schema.optional(Schema.Unknown),
});

export type EntityDetailsRelatedEntity = typeof EntityDetailsRelatedEntity.Type;

export type EntityDetailsChildEntity = {
	name: string;
	externalId: string;
	properties: unknown;
	entitySchemaSlug: string;
	image?: EntityImage | null;
	childEntities?: ReadonlyArray<EntityDetailsChildEntity>;
};

type EncodedEntityDetailsChildEntity = {
	readonly name: string;
	readonly externalId: string;
	readonly properties: unknown;
	readonly entitySchemaSlug: string;
	readonly childEntities?: ReadonlyArray<EncodedEntityDetailsChildEntity>;
	readonly image?:
		| { readonly key: string; readonly type: "s3" }
		| { readonly url: string; readonly type: "remote" }
		| null;
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
		image: Schema.optional(Schema.NullOr(EntityImage)),
		childEntities: Schema.optional(Schema.Array(EntityDetailsChildEntity)),
	}),
).annotations({ identifier: "EntityDetailsChildEntity" });

const EntityDetailsResult = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	image: Schema.optional(Schema.NullOr(EntityImage)),
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

const ProcessedChildEntity = Schema.Struct({
	entity: ListedEntity,
	entitySchemaId: EntitySchemaId,
});

const getBuiltinEntitySchemaProperties = (slug: string) =>
	builtinEntitySchemas().find((schema) => schema.slug === slug)?.propertiesSchema ?? null;

export const processChildEntityTree = (input: {
	activityPrefix: string;
	parentEntityId: EntityId;
	sandboxScriptId: SandboxScriptId;
	parentEntitySchemaId: EntitySchemaId;
	childEntities: ReadonlyArray<EntityDetailsChildEntity>;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* EntitiesRepository;
		const entitySchemasRepository = yield* EntitySchemasRepository;
		const relationshipsRepository = yield* RelationshipsRepository;
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
						const propertiesSchema = getBuiltinEntitySchemaProperties(childEntity.entitySchemaSlug);
						if (!entitySchema || !propertiesSchema) {
							return yield* new SandboxRunError({
								message: `Child entity schema not found: ${childEntity.entitySchemaSlug}`,
							});
						}

						const properties = yield* parseAppSchemaProperties({
							kind: "Entity",
							properties: childEntity.properties,
							propertiesSchema,
						}).pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
						const populatedAt = yield* DateTime.nowAsDate;
						const entity = yield* runWithDb(
							repository.createOrUpdateGlobalEntity({
								properties,
								populatedAt,
								name: childEntity.name,
								entitySchemaId: entitySchema.id,
								image: childEntity.image ?? null,
								externalId: childEntity.externalId,
								sandboxScriptId: input.sandboxScriptId,
							}),
						).pipe(dieOnDbError);

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
						const properties = yield* parseAppSchemaProperties({
							properties: {},
							kind: "Relationship",
							propertiesSchema: relationshipSchema.propertiesSchema,
						}).pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));

						yield* runWithDb(
							relationshipsRepository.upsertEntityRelationship({
								properties,
								sourceEntityId: parentEntityId,
								targetEntityId: child.entity.id,
								relationshipSchemaId: relationshipSchema.id,
							}),
						).pipe(dieOnDbError);
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
	}).pipe(dieOnDbError);

export const processRelatedEntity = Effect.fn("processRelatedEntity")(function* (input: {
	sourceEntityId: EntityId;
	sourceEntitySchemaId: EntitySchemaId;
	relatedEntity: EntityDetailsRelatedEntity;
}) {
	const runWithDb = yield* DbRunner;
	const repository = yield* EntitiesRepository;
	const relationshipsRepository = yield* RelationshipsRepository;
	const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

	const entitySchemaScript = yield* runWithDb(
		repository.findEntitySchemaScriptBySlug(input.relatedEntity.scriptSlug),
	);
	if (!entitySchemaScript) {
		return;
	}

	const relatedEntity = yield* runWithDb(
		repository.createOrUpdateGlobalEntity({
			image: null,
			populatedAt: null,
			properties: {},
			name: input.relatedEntity.name,
			externalId: input.relatedEntity.externalId,
			entitySchemaId: entitySchemaScript.entitySchemaId,
			sandboxScriptId: entitySchemaScript.sandboxScriptId,
		}),
	);

	const { reverseDirection } = input.relatedEntity;
	const sourceEntityId = reverseDirection ? input.sourceEntityId : relatedEntity.id;
	const targetEntityId = reverseDirection ? relatedEntity.id : input.sourceEntityId;
	const sourceSchemaId = reverseDirection
		? input.sourceEntitySchemaId
		: entitySchemaScript.entitySchemaId;
	const targetSchemaId = reverseDirection
		? entitySchemaScript.entitySchemaId
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
	const properties = yield* parseAppSchemaProperties({
		kind: "Relationship",
		properties: relProps === undefined ? {} : relProps,
		propertiesSchema: relationshipSchema.propertiesSchema,
	}).pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));

	yield* runWithDb(
		relationshipsRepository.upsertEntityRelationship({
			properties,
			sourceEntityId,
			targetEntityId,
			relationshipSchemaId: relationshipSchema.id,
		}),
	);
}, dieOnDbError);
