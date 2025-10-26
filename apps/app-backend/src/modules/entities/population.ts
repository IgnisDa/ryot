import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "../../lib/db";
import { SandboxRunError, dieOnDbError, unknownToMessage } from "../../lib/errors";
import { parseAppSchemaProperties } from "../../lib/property-schema-runtime";
import { SandboxService } from "../../lib/sandbox";
import { RelationshipSchemasRepository } from "../relationship-schemas/repository";
import { SandboxRepository } from "../sandbox/repository";
import { EntitiesRepository } from "./repository";
import type { ListedEntity } from "./schemas";

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
}): Effect.Effect<
	ListedEntity,
	SandboxRunError,
	DbRunner | SandboxService | EntitiesRepository | SandboxRepository | RelationshipSchemasRepository
> =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const sandbox = yield* SandboxService;
		const repository = yield* EntitiesRepository;
		const sandboxRepository = yield* SandboxRepository;

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

		const script = yield* runWithDb(
			sandboxRepository.getScriptForUser({ userId: input.userId, scriptId: input.scriptId }),
		);
		if (!script) {
			return yield* new SandboxRunError({ message: "Sandbox script not found" });
		}

		const entitySchemaScope = yield* runWithDb(
			repository.findEntitySchemaById(input.entitySchemaId),
		);
		if (!entitySchemaScope) {
			return yield* new SandboxRunError({ message: "Entity schema not found" });
		}

		const sandboxResult = yield* sandbox
			.run({
				code: script.code,
				scriptId: script.id,
				userId: input.userId,
				driverName: "details",
				executionId: input.executionId,
				context: { externalId: input.externalId },
				allowedHostFunctions: script.metadata.allowedHostFunctions ?? [],
			})
			.pipe(Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })));

		if (!sandboxResult.success || sandboxResult.error) {
			return yield* new SandboxRunError({
				message: sandboxResult.error ?? "Sandbox script failed",
			});
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
