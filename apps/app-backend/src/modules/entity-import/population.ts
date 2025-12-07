import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type {
	EntitySchemaId,
	EntityId,
	RelationshipSchemaId,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
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
	synchronization: Schema.Literal("authoritative", "additive"),
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
	childEntities?: ReadonlyArray<EntityDetailsChildEntity> | undefined;
};

type EncodedEntityDetailsChildEntity = {
	readonly name: string;
	readonly externalId: string;
	readonly properties: unknown;
	readonly entitySchemaSlug: string;
	readonly childEntities?: ReadonlyArray<EncodedEntityDetailsChildEntity> | undefined;
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

type ProcessedChildEntity = {
	entity: ListedEntity;
	entitySchemaId: EntitySchemaId;
};

export const processChildEntityTree = Effect.fn("processChildEntityTree")(function* (input: {
	syncExisting?: boolean;
	parentEntityId: EntityId;
	parentEntitySchemaSlug?: string | undefined;
	sandboxScriptId: SandboxScriptId;
	parentEntitySchemaId: EntitySchemaId;
	childEntities: ReadonlyArray<EntityDetailsChildEntity>;
	childEntitySchemaSlugs?: Readonly<Record<string, string>> | undefined;
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

	const synchronizeGlobalRelationships = Effect.fn(
		"synchronizeGlobalRelationshipsInEntityPopulation",
	)(function* (syncInput: {
		anchorEntityId: EntityId;
		propertiesSchema: AppSchema;
		direction: "incoming" | "outgoing";
		relationshipSchemaId: RelationshipSchemaId;
		synchronization: "additive" | "authoritative";
		onConflict: "preserveExisting" | "replaceProperties";
		entries: ReadonlyArray<{ entityId: EntityId; properties: Record<string, unknown> }>;
	}) {
		const existing = yield* runWithDb(
			relationshipsRepository.listGlobalRelationships({
				type: "anchored",
				direction: syncInput.direction,
				anchorEntityId: syncInput.anchorEntityId,
				relationshipSchemaId: syncInput.relationshipSchemaId,
			}),
		).pipe(dieOnDbError);
		const existingByEntityId = new Map(
			existing.map((relationship) => [
				syncInput.direction === "outgoing"
					? relationship.targetEntityId
					: relationship.sourceEntityId,
				relationship,
			]),
		);
		const entries = new Map(syncInput.entries.map((entry) => [entry.entityId, entry]));

		for (const entry of entries.values()) {
			const sourceEntityId =
				syncInput.direction === "outgoing" ? syncInput.anchorEntityId : entry.entityId;
			const targetEntityId =
				syncInput.direction === "outgoing" ? entry.entityId : syncInput.anchorEntityId;
			const identity = {
				sourceEntityId,
				targetEntityId,
				scope: "global" as const,
				relationshipSchemaId: syncInput.relationshipSchemaId,
			};
			const relationshipInput = {
				...identity,
				properties: entry.properties,
				propertiesSchema: syncInput.propertiesSchema,
			};
			const current = existingByEntityId.get(entry.entityId);
			if (current) {
				if (syncInput.onConflict === "replaceProperties") {
					yield* relationships
						.update(relationshipInput)
						.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
				}
				continue;
			}

			const created = yield* relationships
				.create(relationshipInput)
				.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
			if (!created.wasInserted && syncInput.onConflict === "replaceProperties") {
				yield* relationships
					.update(relationshipInput)
					.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
			}
		}

		if (syncInput.synchronization === "authoritative") {
			for (const relationship of existing) {
				const relatedEntityId =
					syncInput.direction === "outgoing"
						? relationship.targetEntityId
						: relationship.sourceEntityId;
				if (entries.has(relatedEntityId)) {
					continue;
				}

				yield* relationships
					.delete({
						scope: "global",
						sourceEntityId: relationship.sourceEntityId,
						targetEntityId: relationship.targetEntityId,
						relationshipSchemaId: relationship.relationshipSchemaId,
					})
					.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
			}
		}
	});

	const processNode = (
		childEntity: EntityDetailsChildEntity,
		parentEntityId: EntityId,
		parentEntitySchemaId: EntitySchemaId,
	): Effect.Effect<ProcessedChildEntity, SandboxRunError> =>
		Effect.gen(function* () {
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
			const child = { entity, entitySchemaId: entitySchema.id };
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

			const relationshipInput = {
				properties: {},
				scope: "global" as const,
				sourceEntityId: parentEntityId,
				targetEntityId: child.entity.id,
				relationshipSchemaId: relationshipSchema.id,
				propertiesSchema: relationshipSchema.propertiesSchema,
			};
			const created = yield* relationships
				.create(relationshipInput)
				.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
			if (!created.wasInserted) {
				yield* relationships
					.update(relationshipInput)
					.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
			}

			const nestedChildren: ProcessedChildEntity[] = [];
			for (const nestedChildEntity of childEntity.childEntities ?? []) {
				nestedChildren.push(
					yield* processNode(nestedChildEntity, child.entity.id, child.entitySchemaId),
				);
			}

			if (input.syncExisting) {
				const nestedRelationshipSchema = yield* findChildRelationshipSchema(
					child.entitySchemaId,
					childEntity.entitySchemaSlug,
					nestedChildren[0]?.entitySchemaId,
				);
				if (nestedRelationshipSchema) {
					yield* synchronizeGlobalRelationships({
						entries: nestedChildren.map((nestedChild) => ({
							entityId: nestedChild.entity.id,
							properties: {},
						})),
						direction: "outgoing",
						onConflict: "preserveExisting",
						anchorEntityId: child.entity.id,
						synchronization: "authoritative",
						relationshipSchemaId: nestedRelationshipSchema.id,
						propertiesSchema: nestedRelationshipSchema.propertiesSchema,
					});
				}
			}

			return child;
		});

	const processedChildren: ProcessedChildEntity[] = [];
	for (const childEntity of input.childEntities) {
		processedChildren.push(
			yield* processNode(childEntity, input.parentEntityId, input.parentEntitySchemaId),
		);
	}

	if (input.syncExisting) {
		const relationshipSchema = yield* findChildRelationshipSchema(
			input.parentEntitySchemaId,
			input.parentEntitySchemaSlug,
			processedChildren[0]?.entitySchemaId,
		);
		if (relationshipSchema) {
			yield* synchronizeGlobalRelationships({
				direction: "outgoing",
				onConflict: "preserveExisting",
				synchronization: "authoritative",
				anchorEntityId: input.parentEntityId,
				relationshipSchemaId: relationshipSchema.id,
				propertiesSchema: relationshipSchema.propertiesSchema,
				entries: processedChildren.map((child) => ({ properties: {}, entityId: child.entity.id })),
			});
		}
	}
});
