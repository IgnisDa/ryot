import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type {
	EntitySchemaId,
	EntityId,
	RelationshipSchemaId,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";
import { asRecord } from "@ryot/ts-utils/predicates";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import type { SaveEntityOutcome } from "#modules/entities/repository-types";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import type { GlobalRelationshipSyncOutcome } from "#modules/relationships/repository-support";
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
	entitySchemaSlug: string;
	entitySchemaId: EntitySchemaId;
};

export type PopulationEntityMutation = {
	entitySchemaSlug: string;
	outcome: SaveEntityOutcome;
	owningSeason?: { name: string | null; number: number | null } | undefined;
};

export type PopulationRelationshipSync = {
	anchorEntityId: EntityId;
	direction: "incoming" | "outgoing";
	outcome: GlobalRelationshipSyncOutcome;
	relationshipSchemaId: RelationshipSchemaId;
	owningSeason?: { name: string | null; number: number | null } | undefined;
};

export type PopulationMutationResult = {
	entities: Array<PopulationEntityMutation>;
	relationships: Array<PopulationRelationshipSync>;
};

const owningSeasonFrom = (entity: ListedEntity, entitySchemaSlug: string) => {
	if (entitySchemaSlug !== "show-season") {
		return undefined;
	}
	const seasonNumber = asRecord(entity.properties)?.["seasonNumber"];
	return {
		name: entity.name,
		number: typeof seasonNumber === "number" ? seasonNumber : null,
	};
};

export const processChildEntityTree = Effect.fn("processChildEntityTree")(function* (input: {
	syncExisting?: boolean;
	parentEntityId: EntityId;
	sandboxScriptId: SandboxScriptId;
	parentEntitySchemaId: EntitySchemaId;
	parentEntitySchemaSlug?: string | undefined;
	childEntities: ReadonlyArray<EntityDetailsChildEntity>;
	childEntitySchemaSlugs?: Readonly<Record<string, string>> | undefined;
}) {
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const relationships = yield* RelationshipsService;
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

	const result: PopulationMutationResult = { entities: [], relationships: [] };
	const syncChildrenToParent = Effect.fn("syncChildrenToParent")(function* (syncInput: {
		parentEntityId: EntityId;
		parentEntitySchemaId: EntitySchemaId;
		parentEntitySchemaSlug?: string | undefined;
		children: ReadonlyArray<ProcessedChildEntity>;
		owningSeason?: PopulationRelationshipSync["owningSeason"] | undefined;
	}) {
		const relationshipSchema = yield* findChildRelationshipSchema(
			syncInput.parentEntitySchemaId,
			syncInput.parentEntitySchemaSlug,
			syncInput.children[0]?.entitySchemaId,
		);
		if (!relationshipSchema) {
			return;
		}

		const syncOutcome = yield* runWithDb(
			relationships.syncGlobal({
				type: "anchored",
				direction: "outgoing",
				onConflict: "preserveExisting",
				synchronization: "authoritative",
				anchorEntityId: syncInput.parentEntityId,
				relationshipSchemaId: relationshipSchema.id,
				entries: syncInput.children.map((child) => ({ properties: {}, entityId: child.entity.id })),
			}),
		).pipe(dieOnDbError);
		result.relationships.push({
			outcome: syncOutcome,
			direction: "outgoing",
			anchorEntityId: syncInput.parentEntityId,
			relationshipSchemaId: relationshipSchema.id,
			...(syncInput.owningSeason ? { owningSeason: syncInput.owningSeason } : {}),
		});
	});
	const processNode = (
		childEntity: EntityDetailsChildEntity,
		parentEntitySchemaId: EntitySchemaId,
		parentEntitySchemaSlug?: string,
		parentEntity?: ListedEntity,
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
			const outcome = yield* entities
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
			const entity = outcome.entity;
			const child = {
				entity,
				entitySchemaId: entitySchema.id,
				entitySchemaSlug: childEntity.entitySchemaSlug,
			};
			result.entities.push({
				outcome,
				entitySchemaSlug: childEntity.entitySchemaSlug,
				owningSeason: parentEntity
					? owningSeasonFrom(parentEntity, parentEntitySchemaSlug ?? "")
					: undefined,
			});
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

			const nestedChildren: ProcessedChildEntity[] = [];
			for (const nestedChildEntity of childEntity.childEntities ?? []) {
				nestedChildren.push(
					yield* processNode(
						nestedChildEntity,
						child.entitySchemaId,
						child.entitySchemaSlug,
						child.entity,
					),
				);
			}

			yield* syncChildrenToParent({
				children: nestedChildren,
				parentEntityId: child.entity.id,
				parentEntitySchemaId: child.entitySchemaId,
				parentEntitySchemaSlug: childEntity.entitySchemaSlug,
				owningSeason: owningSeasonFrom(child.entity, child.entitySchemaSlug),
			});

			return child;
		});

	const processedChildren: ProcessedChildEntity[] = [];
	for (const childEntity of input.childEntities) {
		processedChildren.push(
			yield* processNode(childEntity, input.parentEntitySchemaId, input.parentEntitySchemaSlug),
		);
	}

	yield* syncChildrenToParent({
		children: processedChildren,
		parentEntityId: input.parentEntityId,
		parentEntitySchemaId: input.parentEntitySchemaId,
		parentEntitySchemaSlug: input.parentEntitySchemaSlug,
	});
	return result;
});
