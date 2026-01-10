import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { generateId } from "better-auth";
import { Effect, Redacted } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { AppConfig } from "#lib/config";
import { DbRunner } from "#lib/db";
import type { BadRequest, DbError, NotFound } from "#lib/errors";
import { badRequest, notFound } from "#lib/errors";
import { createWorkflowJobId, resolveWorkflowExecutionId } from "#lib/job-id";
import type { RelationshipSchemaId, UserId } from "#lib/schema/brands";
import { EntityId, EntitySchemaId, SandboxScriptId } from "#lib/schema/brands";
import { parseAppSchemaProperties } from "#lib/schema/property-schema-runtime";
import { requireText, trimToNull } from "#lib/validation";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository, type SavedRelationship } from "#modules/relationships/repository";
import { SandboxRepository } from "#modules/sandbox/repository";

import { EntitiesRepository } from "./repository";
import type { CreateEntityBody, ListedEntity } from "./schemas";
import {
	EntityImportWorkflow,
	toEntityImportRunResult,
	type EntityImportRunResult,
} from "./workflows";

const entityNotFoundError = "Entity not found";
const entitySchemaNotFoundError = "Entity schema not found";
const importJobNotFoundError = "Entity import job not found";
const sandboxScriptNotFoundError = "Sandbox script not found";
const relationshipSchemaNotFoundError = "Relationship schema not found";
const partialProvenanceError =
	"externalId and sandboxScriptId must both be provided or both be omitted";

const validateRelationshipSchemaTargets = (input: {
	sourceEntitySchemaId: EntitySchemaId;
	targetEntitySchemaId: EntitySchemaId;
	relationshipSchema: {
		readonly sourceEntitySchemaId: EntitySchemaId | null;
		readonly targetEntitySchemaId: EntitySchemaId | null;
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

	return Effect.void;
};

type EntitiesServiceShape = {
	readonly create: (
		user: CurrentUserValue,
		payload: CreateEntityBody,
	) => Effect.Effect<ListedEntity, BadRequest | DbError | NotFound>;
	readonly getById: (
		user: CurrentUserValue,
		entityIdInput: EntityId,
	) => Effect.Effect<ListedEntity, BadRequest | DbError | NotFound>;
	readonly import: (
		user: CurrentUserValue,
		payload: { scriptId: SandboxScriptId; externalId: string; entitySchemaId: EntitySchemaId },
	) => Effect.Effect<{ jobId: string }, BadRequest | NotFound | DbError>;
	readonly getImportResult: (
		user: CurrentUserValue,
		jobId: string,
	) => Effect.Effect<EntityImportRunResult, NotFound>;
	readonly upsertUserRelationship: (input: {
		userId: UserId;
		sourceEntityId: EntityId;
		targetEntityId: EntityId;
		relationshipSchemaId: RelationshipSchemaId;
		properties: Record<string, unknown>;
	}) => Effect.Effect<SavedRelationship, BadRequest | DbError | NotFound>;
	readonly insertUserRelationship: (input: {
		userId: UserId;
		sourceEntityId: EntityId;
		targetEntityId: EntityId;
		relationshipSchemaId: RelationshipSchemaId;
		properties: Record<string, unknown>;
	}) => Effect.Effect<void, BadRequest | DbError | NotFound>;
	readonly writeEntityRelationship: (input: {
		sourceEntityId: EntityId;
		targetEntityId: EntityId;
		relationshipSchemaId: RelationshipSchemaId;
		properties: Record<string, unknown>;
	}) => Effect.Effect<void, BadRequest | DbError | NotFound>;
};

export class EntitiesService extends Effect.Service<EntitiesService>()("EntitiesService", {
	effect: Effect.gen(function* () {
		const config = yield* AppConfig;
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const repository = yield* EntitiesRepository;
		const sandboxRepository = yield* SandboxRepository;
		const relationshipsRepository = yield* RelationshipsRepository;
		const jobIdSecret = Redacted.value(config.sandbox.jobIdSecret);
		const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

		return {
			create: Effect.fn("EntitiesService.create")(function* (
				user: CurrentUserValue,
				payload: CreateEntityBody,
			) {
				const externalId = payload.externalId ? trimToNull(payload.externalId) : null;
				const trimmedScriptId = payload.sandboxScriptId
					? trimToNull(payload.sandboxScriptId)
					: null;
				const sandboxScriptId = trimmedScriptId ? SandboxScriptId.make(trimmedScriptId) : null;
				const hasExternalId = externalId !== null;
				const hasScriptId = sandboxScriptId !== null;
				if (hasExternalId !== hasScriptId) {
					return yield* badRequest(partialProvenanceError);
				}

				const trimmedEntitySchemaId = trimToNull(payload.entitySchemaId);
				if (!trimmedEntitySchemaId) {
					return yield* badRequest("Entity schema id is required");
				}

				const entitySchemaId = EntitySchemaId.make(trimmedEntitySchemaId);
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

				const name = yield* requireText(payload.name, "Entity name is required");

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
						image: payload.image ?? null,
						...provenance,
					}),
				);
			}),
			getById: Effect.fn("EntitiesService.getById")(function* (
				user: CurrentUserValue,
				entityIdInput: EntityId,
			) {
				const trimmedEntityId = trimToNull(entityIdInput);
				if (!trimmedEntityId) {
					return yield* badRequest("Entity id is required");
				}

				const entityId = EntityId.make(trimmedEntityId);
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
			import: Effect.fn("EntitiesService.import")(function* (
				user: CurrentUserValue,
				payload: { scriptId: SandboxScriptId; externalId: string; entitySchemaId: EntitySchemaId },
			) {
				const trimmedScriptId = trimToNull(payload.scriptId);
				const externalId = trimToNull(payload.externalId);
				const trimmedEntitySchemaId = trimToNull(payload.entitySchemaId);

				if (!trimmedScriptId || !externalId || !trimmedEntitySchemaId) {
					return yield* badRequest("scriptId, externalId, and entitySchemaId are required");
				}

				const entitySchemaId = EntitySchemaId.make(trimmedEntitySchemaId);
				const scriptId = SandboxScriptId.make(trimmedScriptId);
				const script = yield* runWithDb(
					sandboxRepository.getScriptForUser({ userId: user.id, scriptId }),
				);
				if (!script) {
					return yield* notFound(sandboxScriptNotFoundError);
				}

				const entitySchemaScope = yield* runWithDb(
					repository.getEntitySchemaScopeForUser({ userId: user.id, entitySchemaId }),
				);
				if (!entitySchemaScope) {
					return yield* notFound(entitySchemaNotFoundError);
				}

				const executionId = generateId();
				yield* engine
					.execute(EntityImportWorkflow, {
						executionId,
						discard: true,
						payload: { scriptId, externalId, executionId, entitySchemaId, userId: user.id },
					})
					.pipe(Effect.orDie);

				return { jobId: createWorkflowJobId(jobIdSecret, executionId, user.id) };
			}),
			getImportResult: Effect.fn("EntitiesService.getImportResult")(function* (
				user: CurrentUserValue,
				jobId: string,
			) {
				const resolvedJobId = trimToNull(jobId);
				if (!resolvedJobId) {
					return yield* notFound(importJobNotFoundError);
				}

				const executionId = resolveWorkflowExecutionId(jobIdSecret, user.id, resolvedJobId);
				if (!executionId) {
					return yield* notFound(importJobNotFoundError);
				}

				return toEntityImportRunResult(yield* engine.poll(EntityImportWorkflow, executionId));
			}),
			upsertUserRelationship: Effect.fn("EntitiesService.upsertUserRelationship")(
				function* (input: {
					userId: UserId;
					sourceEntityId: EntityId;
					targetEntityId: EntityId;
					relationshipSchemaId: RelationshipSchemaId;
					properties: Record<string, unknown>;
				}) {
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

					yield* validateRelationshipSchemaTargets({
						relationshipSchema,
						sourceEntitySchemaId: sourceEntity.entitySchemaId,
						targetEntitySchemaId: targetEntity.entitySchemaId,
					});

					const properties = yield* parseAppSchemaProperties({
						kind: "Relationship",
						properties: input.properties,
						propertiesSchema: relationshipSchema.propertiesSchema,
					}).pipe(Effect.mapError((error) => badRequest(error.message)));

					return yield* runWithDb(
						relationshipsRepository.upsertRelationship({
							...input,
							properties,
						}),
					);
				},
			),
			insertUserRelationship: Effect.fn("EntitiesService.insertUserRelationship")(
				function* (input: {
					userId: UserId;
					sourceEntityId: EntityId;
					targetEntityId: EntityId;
					relationshipSchemaId: RelationshipSchemaId;
					properties: Record<string, unknown>;
				}) {
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

					yield* validateRelationshipSchemaTargets({
						relationshipSchema,
						sourceEntitySchemaId: sourceEntity.entitySchemaId,
						targetEntitySchemaId: targetEntity.entitySchemaId,
					});

					const properties = yield* parseAppSchemaProperties({
						kind: "Relationship",
						properties: input.properties,
						propertiesSchema: relationshipSchema.propertiesSchema,
					}).pipe(Effect.mapError((error) => badRequest(error.message)));

					return yield* runWithDb(
						relationshipsRepository.insertRelationship({ ...input, properties }),
					);
				},
			),
			writeEntityRelationship: Effect.fn("EntitiesService.writeEntityRelationship")(
				function* (input: {
					sourceEntityId: EntityId;
					targetEntityId: EntityId;
					relationshipSchemaId: RelationshipSchemaId;
					properties: Record<string, unknown>;
				}) {
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

					yield* validateRelationshipSchemaTargets({
						relationshipSchema,
						sourceEntitySchemaId: sourceEntity.entitySchemaId,
						targetEntitySchemaId: targetEntity.entitySchemaId,
					});

					const properties = yield* parseAppSchemaProperties({
						kind: "Relationship",
						properties: input.properties,
						propertiesSchema: relationshipSchema.propertiesSchema,
					}).pipe(Effect.mapError((error) => badRequest(error.message)));

					return yield* runWithDb(
						relationshipsRepository.upsertEntityRelationship({ ...input, properties }),
					);
				},
			),
		} satisfies EntitiesServiceShape;
	}),
}) {}
