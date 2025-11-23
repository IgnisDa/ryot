import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { EntitySchemaId, type EntityId, type SandboxScriptId } from "@ryot/contract/schema/brands";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

export const EntityDetailsRelatedEntity = Schema.Struct({
	name: Schema.String,
	externalId: Schema.String,
	scriptSlug: Schema.String,
	relationshipProperties: Schema.optional(Schema.Unknown),
});

export type EntityDetailsRelatedEntity = typeof EntityDetailsRelatedEntity.Type;

export const EntityDetailsRelationshipGroup = Schema.Struct({
	relationshipSchemaSlug: Schema.String,
	direction: Schema.Literal("outgoing", "incoming"),
	entities: Schema.Array(EntityDetailsRelatedEntity),
});

export type EntityDetailsRelationshipGroup = typeof EntityDetailsRelationshipGroup.Type;

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
	relatedEntityGroups: Schema.optional(Schema.Array(EntityDetailsRelationshipGroup)),
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
	syncExisting?: boolean;
	parentEntityId: EntityId;
	parentEntitySchemaSlug?: string;
	sandboxScriptId: SandboxScriptId;
	parentEntitySchemaId: EntitySchemaId;
	childEntities: ReadonlyArray<EntityDetailsChildEntity>;
	childEntitySchemaSlugs?: Readonly<Record<string, string>>;
}) {
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const relationships = yield* RelationshipsService;
	const relationshipsRepository = yield* RelationshipsRepository;
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
		return targetSchemaId
			? yield* runWithDb(
					relationshipSchemasRepository.findGlobalBySchemaIds({
						sourceEntitySchemaId,
						targetEntitySchemaId: targetSchemaId,
					}),
				).pipe(dieOnDbError)
			: null;
	});

	const processNode = (
		childEntity: EntityDetailsChildEntity,
		parentEntityId: EntityId,
		parentEntitySchemaId: EntitySchemaId,
		path: string,
	): Effect.Effect<
		typeof ProcessedChildEntity.Type,
		SandboxRunError,
		WorkflowEngine | WorkflowInstance
	> =>
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
							onConflict: input.syncExisting ? "replaceExisting" : undefined,
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

			const nestedChildren: Array<typeof ProcessedChildEntity.Type> = [];
			for (const [index, nestedChildEntity] of (childEntity.childEntities ?? []).entries()) {
				nestedChildren.push(
					yield* processNode(
						nestedChildEntity,
						child.entity.id,
						child.entitySchemaId,
						`${path}-${index}`,
					),
				);
			}

			if (input.syncExisting) {
				const relationshipSchema = yield* findChildRelationshipSchema(
					child.entitySchemaId,
					childEntity.entitySchemaSlug,
					nestedChildren[0]?.entitySchemaId,
				);
				if (relationshipSchema) {
					yield* runWithDb(
						relationshipsRepository.syncGlobalRelationshipTargets({
							sourceEntityId: child.entity.id,
							targetEntityIds: nestedChildren.map((nestedChild) => nestedChild.entity.id),
							relationshipSchemaId: relationshipSchema.id,
						}),
					).pipe(dieOnDbError);
				}
			}

			return child;
		});

	const processedChildren: Array<typeof ProcessedChildEntity.Type> = [];
	for (const [index, childEntity] of input.childEntities.entries()) {
		processedChildren.push(
			yield* processNode(
				childEntity,
				input.parentEntityId,
				input.parentEntitySchemaId,
				String(index),
			),
		);
	}

	if (input.syncExisting) {
		const relationshipSchema = yield* findChildRelationshipSchema(
			input.parentEntitySchemaId,
			input.parentEntitySchemaSlug,
			processedChildren[0]?.entitySchemaId,
		);
		if (relationshipSchema) {
			yield* runWithDb(
				relationshipsRepository.syncGlobalRelationshipTargets({
					sourceEntityId: input.parentEntityId,
					targetEntityIds: processedChildren.map((child) => child.entity.id),
					relationshipSchemaId: relationshipSchema.id,
				}),
			).pipe(dieOnDbError);
		}
	}
});
