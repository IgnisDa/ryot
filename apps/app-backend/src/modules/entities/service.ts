import { Effect } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import { DbRunner, TransactionRunner } from "../../lib/db";
import type { DbError, NotFound } from "../../lib/errors";
import { BadRequest, badRequest, notFound } from "../../lib/errors";
import { parseAppSchemaProperties } from "../../lib/property-schema-runtime";
import { requireText, trimToNull } from "../../lib/validation";
import { RelationshipSchemasRepository } from "../relationship-schemas/repository";
import { EntitiesRepository, type SavedRelationship } from "./repository";
import type { CreateEntityBody, ListedEntity } from "./schemas";

const entityNotFoundError = "Entity not found";
const entitySchemaNotFoundError = "Entity schema not found";
const relationshipSchemaNotFoundError = "Relationship schema not found";
const libraryEntityUserStateError = "Library entity user state cannot be cleared";
const partialProvenanceError =
	"externalId and sandboxScriptId must both be provided or both be omitted";

const validateRelationshipSchemaTargets = (input: {
	sourceEntitySchemaId: string;
	targetEntitySchemaId: string;
	relationshipSchema: {
		readonly sourceEntitySchemaId: string | null;
		readonly targetEntitySchemaId: string | null;
	};
}) => {
	if (
		input.relationshipSchema.sourceEntitySchemaId &&
		input.relationshipSchema.sourceEntitySchemaId !== input.sourceEntitySchemaId
	) {
		return badRequest("Relationship source entity schema does not match");
	}

	if (
		input.relationshipSchema.targetEntitySchemaId &&
		input.relationshipSchema.targetEntitySchemaId !== input.targetEntitySchemaId
	) {
		return badRequest("Relationship target entity schema does not match");
	}

	return null;
};

type EntitiesServiceShape = {
	readonly create: (
		user: CurrentUserValue,
		payload: CreateEntityBody,
	) => Effect.Effect<ListedEntity, BadRequest | DbError | NotFound>;
	readonly getById: (
		user: CurrentUserValue,
		entityIdInput: string,
	) => Effect.Effect<ListedEntity, BadRequest | DbError | NotFound>;
	readonly clearUserState: (
		user: CurrentUserValue,
		entityIdInput: string,
	) => Effect.Effect<
		{ entityId: string; deletedEventsCount: number; deletedRelationshipsCount: number },
		BadRequest | DbError | NotFound
	>;
	readonly upsertUserRelationship: (input: {
		userId: string;
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
		properties: Record<string, unknown>;
	}) => Effect.Effect<SavedRelationship, BadRequest | DbError | NotFound>;
	readonly writeRelationship: (input: {
		userId: string;
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
		properties: Record<string, unknown>;
	}) => Effect.Effect<void, BadRequest | DbError | NotFound>;
	readonly writeEntityRelationship: (input: {
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
		properties: Record<string, unknown>;
	}) => Effect.Effect<void, BadRequest | DbError | NotFound>;
};

export class EntitiesService extends Effect.Service<EntitiesService>()("EntitiesService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const runInTransaction = yield* TransactionRunner;
		const repository = yield* EntitiesRepository;
		const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

		return {
			create: (user: CurrentUserValue, payload: CreateEntityBody) =>
				Effect.gen(function* () {
					const externalId = payload.externalId ? trimToNull(payload.externalId) : null;
					const sandboxScriptId = payload.sandboxScriptId
						? trimToNull(payload.sandboxScriptId)
						: null;
					const hasExternalId = externalId !== null;
					const hasScriptId = sandboxScriptId !== null;
					if (hasExternalId !== hasScriptId) {
						return yield* badRequest(partialProvenanceError);
					}

					const entitySchemaId = trimToNull(payload.entitySchemaId);
					if (!entitySchemaId) {
						return yield* badRequest("Entity schema id is required");
					}

					const scope = yield* runWithDb(
						repository.getEntitySchemaScopeForUser({ userId: user.id, entitySchemaId }),
					);
					if (!scope) {
						return yield* notFound(entitySchemaNotFoundError);
					}

					const provenance = externalId && sandboxScriptId ? { externalId, sandboxScriptId } : null;

					if (provenance) {
						const existing = yield* runWithDb(
							repository.findEntityByExternalIdForUser({
								entitySchemaId,
								userId: user.id,
								externalId: provenance.externalId,
								sandboxScriptId: provenance.sandboxScriptId,
							}),
						);
						if (existing) {
							return existing;
						}
					}

					const name = requireText(payload.name, "Entity name is required");
					if (name instanceof BadRequest) {
						return yield* name;
					}

					const properties = yield* parseAppSchemaProperties({
						kind: "Entity",
						properties: payload.properties,
						propertiesSchema: scope.propertiesSchema,
					}).pipe(Effect.mapError((error) => badRequest(error.message)));

					return yield* runWithDb(
						repository.createEntity({
							name,
							properties,
							entitySchemaId,
							userId: user.id,
							image: payload.image ? trimToNull(payload.image) : null,
							...provenance,
						}),
					);
				}),
			getById: (user: CurrentUserValue, entityIdInput: string) =>
				Effect.gen(function* () {
					const entityId = trimToNull(entityIdInput);
					if (!entityId) {
						return yield* badRequest("Entity id is required");
					}

					const scope = yield* runWithDb(
						repository.getEntityScopeForUser({ userId: user.id, entityId }),
					);
					if (!scope) {
						return yield* notFound(entityNotFoundError);
					}

					const entity = yield* runWithDb(repository.getByIdForUser({ userId: user.id, entityId }));
					if (!entity) {
						return yield* notFound(entityNotFoundError);
					}

					return entity;
				}),
			clearUserState: (user: CurrentUserValue, entityIdInput: string) =>
				Effect.gen(function* () {
					const entityId = trimToNull(entityIdInput);
					if (!entityId) {
						return yield* badRequest("Entity id is required");
					}

					const scope = yield* runWithDb(
						repository.getEntityScopeForUser({ userId: user.id, entityId }),
					);
					if (!scope) {
						return yield* notFound(entityNotFoundError);
					}

					if (scope.entitySchemaSlug === "library") {
						return yield* badRequest(libraryEntityUserStateError);
					}

					return yield* runInTransaction(
						Effect.gen(function* () {
							const deletedEventsCount = yield* repository.deleteUserEventsForEntity({
								entityId,
								userId: user.id,
							});
							const deletedRelationshipsCount = yield* repository.deleteUserRelationshipsForEntity({
								entityId,
								userId: user.id,
							});

							return { entityId, deletedEventsCount, deletedRelationshipsCount };
						}),
					);
				}),
			upsertUserRelationship: (input: {
				userId: string;
				sourceEntityId: string;
				targetEntityId: string;
				relationshipSchemaId: string;
				properties: Record<string, unknown>;
			}) =>
				Effect.gen(function* () {
					const relationshipSchema = yield* runWithDb(
						relationshipSchemasRepository.findById(input.relationshipSchemaId, input.userId),
					);
					if (!relationshipSchema) {
						return yield* notFound(relationshipSchemaNotFoundError);
					}

					const [sourceEntity, targetEntity] = yield* Effect.all([
						runWithDb(
							repository.getEntityScopeForUser({
								userId: input.userId,
								entityId: input.sourceEntityId,
							}),
						),
						runWithDb(
							repository.getEntityScopeForUser({
								userId: input.userId,
								entityId: input.targetEntityId,
							}),
						),
					]);
					if (!sourceEntity || !targetEntity) {
						return yield* notFound(entityNotFoundError);
					}

					const mismatch = validateRelationshipSchemaTargets({
						relationshipSchema,
						sourceEntitySchemaId: sourceEntity.entitySchemaId,
						targetEntitySchemaId: targetEntity.entitySchemaId,
					});
					if (mismatch) {
						return yield* mismatch;
					}

					const properties = yield* parseAppSchemaProperties({
						kind: "Relationship",
						properties: input.properties,
						propertiesSchema: relationshipSchema.propertiesSchema,
					}).pipe(Effect.mapError((error) => badRequest(error.message)));

					return yield* runWithDb(
						repository.upsertRelationship({
							...input,
							properties,
						}),
					);
				}),
			writeRelationship: (input: {
				userId: string;
				sourceEntityId: string;
				targetEntityId: string;
				relationshipSchemaId: string;
				properties: Record<string, unknown>;
			}) =>
				Effect.gen(function* () {
					const relationshipSchema = yield* runWithDb(
						relationshipSchemasRepository.findById(input.relationshipSchemaId, input.userId),
					);
					if (!relationshipSchema) {
						return yield* notFound(relationshipSchemaNotFoundError);
					}

					const [sourceEntity, targetEntity] = yield* Effect.all([
						runWithDb(
							repository.getEntityScopeForUser({
								userId: input.userId,
								entityId: input.sourceEntityId,
							}),
						),
						runWithDb(
							repository.getEntityScopeForUser({
								userId: input.userId,
								entityId: input.targetEntityId,
							}),
						),
					]);
					if (!sourceEntity || !targetEntity) {
						return yield* notFound(entityNotFoundError);
					}

					const mismatch = validateRelationshipSchemaTargets({
						relationshipSchema,
						sourceEntitySchemaId: sourceEntity.entitySchemaId,
						targetEntitySchemaId: targetEntity.entitySchemaId,
					});
					if (mismatch) {
						return yield* mismatch;
					}

					const properties = yield* parseAppSchemaProperties({
						kind: "Relationship",
						properties: input.properties,
						propertiesSchema: relationshipSchema.propertiesSchema,
					}).pipe(Effect.mapError((error) => badRequest(error.message)));

					return yield* runWithDb(repository.insertRelationship({ ...input, properties }));
				}),
			writeEntityRelationship: (input: {
				sourceEntityId: string;
				targetEntityId: string;
				relationshipSchemaId: string;
				properties: Record<string, unknown>;
			}) =>
				Effect.gen(function* () {
					const relationshipSchema = yield* runWithDb(
						relationshipSchemasRepository.findById(input.relationshipSchemaId, null),
					);
					if (!relationshipSchema) {
						return yield* notFound(relationshipSchemaNotFoundError);
					}

					const [sourceEntity, targetEntity] = yield* Effect.all([
						runWithDb(repository.getEntityScopeById(input.sourceEntityId)),
						runWithDb(repository.getEntityScopeById(input.targetEntityId)),
					]);
					if (!sourceEntity || !targetEntity) {
						return yield* notFound(entityNotFoundError);
					}

					const mismatch = validateRelationshipSchemaTargets({
						relationshipSchema,
						sourceEntitySchemaId: sourceEntity.entitySchemaId,
						targetEntitySchemaId: targetEntity.entitySchemaId,
					});
					if (mismatch) {
						return yield* mismatch;
					}

					const properties = yield* parseAppSchemaProperties({
						kind: "Relationship",
						properties: input.properties,
						propertiesSchema: relationshipSchema.propertiesSchema,
					}).pipe(Effect.mapError((error) => badRequest(error.message)));

					return yield* runWithDb(repository.upsertEntityRelationship({ ...input, properties }));
				}),
		} satisfies EntitiesServiceShape;
	}),
}) {}
