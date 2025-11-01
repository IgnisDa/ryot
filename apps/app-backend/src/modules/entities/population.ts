import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "~/lib/db";
import { SandboxRunError, dieOnDbError, unknownToMessage } from "~/lib/errors";
import { parseAppSchemaProperties } from "~/lib/property-schema-runtime";
import { RelationshipSchemasRepository } from "~/modules/relationship-schemas/repository";
import { RunSandboxWorkflow } from "~/modules/sandbox/definitions";

import { EntitiesRepository } from "./repository";

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === "object" && !Array.isArray(v);

const EntityDetailsRelatedEntity = Schema.Struct({
	name: Schema.String,
	externalId: Schema.String,
	scriptSlug: Schema.String,
	reverseDirection: Schema.optional(Schema.Boolean),
	relationshipProperties: Schema.optional(Schema.Unknown),
});

type EntityDetailsRelatedEntity = typeof EntityDetailsRelatedEntity.Type;

const EntityDetailsResult = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	relatedEntities: Schema.optional(Schema.Array(EntityDetailsRelatedEntity)),
});

const decodeEntityDetailsResult = Schema.decodeUnknown(EntityDetailsResult);

const processRelatedEntity = (input: {
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
		const properties: Record<string, unknown> = isPlainRecord(relProps) ? relProps : {};

		yield* runWithDb(
			repository.upsertEntityRelationship({
				properties,
				sourceEntityId,
				targetEntityId,
				relationshipSchemaId: relationshipSchema.id,
			}),
		);
	}).pipe(
		Effect.catchAll(() => Effect.void),
		dieOnDbError,
	);

export const populateGlobalEntity = (input: {
	userId: string;
	scriptId: string;
	externalId: string;
	executionId: string;
	entitySchemaId: string;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const repository = yield* EntitiesRepository;

		const existing = yield* runWithDb(
			repository.findGlobalEntityByExternalId({
				externalId: input.externalId,
				sandboxScriptId: input.scriptId,
				entitySchemaId: input.entitySchemaId,
			}),
		);
		if (existing && existing.populatedAt !== null) {
			return existing;
		}

		const entitySchemaScope = yield* runWithDb(
			repository.findEntitySchemaById(input.entitySchemaId),
		);
		if (!entitySchemaScope) {
			return yield* new SandboxRunError({ message: "Entity schema not found" });
		}

		const sandboxResult = yield* engine
			.execute(RunSandboxWorkflow, {
				executionId: input.executionId,
				payload: {
					userId: input.userId,
					driverName: "details",
					scriptId: input.scriptId,
					executionId: input.executionId,
					context: { externalId: input.externalId },
				},
			})
			.pipe(Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })));

		if (sandboxResult.error) {
			return yield* new SandboxRunError({ message: sandboxResult.error });
		}

		const details = yield* decodeEntityDetailsResult(sandboxResult.value).pipe(
			Effect.mapError(
				(error) => new SandboxRunError({ message: `Invalid entity details: ${error.message}` }),
			),
		);

		const validatedProperties = yield* parseAppSchemaProperties({
			kind: "Entity",
			properties: details.properties,
			propertiesSchema: entitySchemaScope.propertiesSchema,
		}).pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));

		const now = yield* DateTime.nowAsDate;
		const entity = yield* runWithDb(
			repository.createOrUpdateGlobalEntity({
				image: null,
				populatedAt: now,
				name: details.name,
				externalId: input.externalId,
				properties: validatedProperties,
				sandboxScriptId: input.scriptId,
				entitySchemaId: input.entitySchemaId,
			}),
		);

		yield* Effect.forEach(
			details.relatedEntities ?? [],
			(relatedEntity) =>
				processRelatedEntity({
					relatedEntity,
					sourceEntityId: entity.id,
					sourceEntitySchemaId: input.entitySchemaId,
				}),
			{ discard: true },
		);

		return entity;
	}).pipe(
		Effect.mapError((error) =>
			error instanceof SandboxRunError
				? error
				: new SandboxRunError({ message: unknownToMessage(error) }),
		),
	);
