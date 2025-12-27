import { Effect, Schema } from "effect";

import { DbRunner } from "~/lib/db";
import { SandboxRunError, dieOnDbError } from "~/lib/errors";
import { parseAppSchemaProperties } from "~/lib/property-schema-runtime";
import { RelationshipSchemasRepository } from "~/modules/relationship-schemas/repository";

import { EntitiesRepository } from "./repository";

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === "object" && !Array.isArray(v);

export const EntityDetailsRelatedEntity = Schema.Struct({
	name: Schema.String,
	externalId: Schema.String,
	scriptSlug: Schema.String,
	reverseDirection: Schema.optional(Schema.Boolean),
	relationshipProperties: Schema.optional(Schema.Unknown),
});

export type EntityDetailsRelatedEntity = typeof EntityDetailsRelatedEntity.Type;

const EntityDetailsResult = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
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
			Schema.Struct({ kind: Schema.Literal("null"), value: Schema.Null }),
			Schema.Struct({ kind: Schema.Literal("number"), value: Schema.Number }),
		),
	),
});

export type EntitySearchItem = typeof EntitySearchItem.Type;

const EntitySearchResult = Schema.Struct({ items: Schema.Array(EntitySearchItem) });

export const decodeEntitySearchResult = Schema.decodeUnknown(EntitySearchResult);

export const processRelatedEntity = (input: {
	sourceEntityId: string;
	sourceEntitySchemaId: string;
	relatedEntity: EntityDetailsRelatedEntity;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* EntitiesRepository;
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
		const sourceSchemaId = reverseDirection
			? entitySchemaScript.entitySchemaId
			: input.sourceEntitySchemaId;
		const targetSchemaId = reverseDirection
			? input.sourceEntitySchemaId
			: entitySchemaScript.entitySchemaId;
		const sourceEntityId = reverseDirection ? relatedEntity.id : input.sourceEntityId;
		const targetEntityId = reverseDirection ? input.sourceEntityId : relatedEntity.id;

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
			properties: isPlainRecord(relProps) ? relProps : {},
			propertiesSchema: relationshipSchema.propertiesSchema,
		}).pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));

		yield* runWithDb(
			repository.upsertEntityRelationship({
				properties,
				sourceEntityId,
				targetEntityId,
				relationshipSchemaId: relationshipSchema.id,
			}),
		);
	}).pipe(dieOnDbError);
