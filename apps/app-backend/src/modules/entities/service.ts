import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import {
	TranslationStatus,
	type EntityDetail,
	type ListedEntity,
} from "@ryot/contract/modules/entities/schemas";
import type { RowItem } from "@ryot/contract/modules/query-engine/language";
import { EntityId, EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
import type { UserId } from "@ryot/contract/schema/brands";
import { buildEntityDetailQueryDocument } from "@ryot/query-engine";
import { generateId } from "better-auth";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { requireText, trimToNull } from "#lib/shared/validation";
import {
	getOptionalIsoStringField,
	getOptionalStringField,
	requireFieldValue,
	requireIsoStringField,
	requireRowsResponse,
	requireStringField,
} from "#modules/query-engine/response-helpers";
import { QueryEngineService } from "#modules/query-engine/service";

import { LifecycleDispatch } from "./lifecycle-dispatch";
import type { EntityMutationSnapshot } from "./mutation-outcomes";
import { EntitiesRepository, type InsertEntityInputBase } from "./repository";

type CreateEntityInput = {
	name: string;
	properties: unknown;
	origin?: AutomationOrigin;
	entitySchemaId: EntitySchemaId;
} & (
	| {
			scope: "global";
			externalId: string;
			populatedAt: Date | null;
			sandboxScriptId: SandboxScriptId;
	  }
	| {
			scope: "user";
			userId: UserId;
			externalId?: string | undefined;
			sandboxScriptId?: SandboxScriptId | undefined;
	  }
);

type CreateAnyEntityInput = InsertEntityInputBase & { properties: unknown };

type UpdateEntityInput = {
	name: string;
	entityId: EntityId;
	properties: unknown;
	populatedAt: Date | null;
	entitySchemaId: EntitySchemaId;
};

type UpsertEntityInput = {
	name: string;
	externalId: string;
	properties: unknown;
	updateExisting: boolean;
	populatedAt: Date | null;
	entitySchemaId: EntitySchemaId;
	sandboxScriptId: SandboxScriptId;
};

const entityNotFoundError = "Entity not found";
const entitySchemaNotFoundError = "Entity schema not found";
const partialProvenanceError =
	"externalId and sandboxScriptId must both be provided or both be omitted";

const toMutationSnapshot = (
	entity: ListedEntity,
	entitySchemaSlug: string,
): EntityMutationSnapshot => ({
	id: entity.id,
	entitySchemaSlug,
	name: entity.name,
	properties: entity.properties,
	entitySchemaId: entity.entitySchemaId,
});

const toListedEntity = Effect.fn("toListedEntityFromQueryEngine")(function* (row: RowItem) {
	const sandboxScriptId = yield* getOptionalStringField(row, "sandboxScriptId");

	return {
		name: yield* requireStringField(row, "name"),
		createdAt: yield* requireIsoStringField(row, "createdAt"),
		updatedAt: yield* requireIsoStringField(row, "updatedAt"),
		id: EntityId.make(yield* requireStringField(row, "id")),
		externalId: yield* getOptionalStringField(row, "externalId"),
		properties: (yield* requireFieldValue(row, "properties")).value,
		populatedAt: yield* getOptionalIsoStringField(row, "populatedAt"),
		sandboxScriptId: sandboxScriptId ? SandboxScriptId.make(sandboxScriptId) : null,
		entitySchemaId: EntitySchemaId.make(yield* requireStringField(row, "entitySchemaId")),
	};
});

export class EntitiesService extends Effect.Service<EntitiesService>()("EntitiesService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* EntitiesRepository;
		const queryEngine = yield* QueryEngineService;
		const lifecycleDispatch = yield* LifecycleDispatch;

		const parseEntityProperties = Effect.fn("EntitiesService.parseEntityProperties")(function* (
			properties: unknown,
			propertiesSchema: Parameters<typeof parseAppSchemaProperties>[0]["propertiesSchema"],
		) {
			return yield* parseAppSchemaProperties({ kind: "Entity", properties, propertiesSchema }).pipe(
				Effect.mapError((error) => badRequest(error.message)),
			);
		});

		const createEntity = Effect.fn("EntitiesService.createEntity")(function* (
			input: CreateAnyEntityInput,
			origin?: AutomationOrigin,
		) {
			if (input.scope === "user") {
				const hasExternalId = input.externalId !== undefined;
				const hasScriptId = input.sandboxScriptId !== undefined;
				if (hasExternalId !== hasScriptId) {
					return yield* badRequest(partialProvenanceError);
				}
			}

			const scope = yield* input.scope === "user"
				? runWithDb(
						repository.getEntitySchemaScopeForUser({
							userId: input.userId,
							entitySchemaId: input.entitySchemaId,
						}),
					)
				: runWithDb(repository.findEntitySchemaById(input.entitySchemaId));
			if (!scope) {
				return yield* notFound(entitySchemaNotFoundError);
			}

			if (
				input.scope === "user" &&
				input.externalId !== undefined &&
				input.sandboxScriptId !== undefined
			) {
				const existing = yield* runWithDb(
					repository.findEntityByExternalIdForUser({
						userId: input.userId,
						externalId: input.externalId,
						entitySchemaId: input.entitySchemaId,
						sandboxScriptId: input.sandboxScriptId,
					}),
				);
				if (existing) {
					return existing;
				}
			}

			const name = yield* requireText(input.name, "Entity name is required");
			const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);
			const occurrenceId = `occ_${generateId()}`;

			const saved = yield* runWithDb(repository.insertEntity({ ...input, name, properties }));

			if (origin && saved.wasInserted) {
				yield* lifecycleDispatch.dispatch({
					origin,
					occurrenceId,
					recordId: saved.entity.id,
					occurredAt: (yield* DateTime.nowAsDate).toISOString(),
					rowUserId: input.scope === "user" ? input.userId : null,
					source: {
						kind: "entity",
						after: {
							properties,
							id: saved.entity.id,
							name: saved.entity.name,
							entitySchemaSlug: scope.slug,
							entitySchemaId: saved.entity.entitySchemaId,
						},
					},
				});
			}

			return saved.entity;
		});

		const create = Effect.fn("EntitiesService.create")(function* (input: CreateEntityInput) {
			return yield* createEntity(input, input.origin);
		});

		const createGlobal = Effect.fn("EntitiesService.createGlobal")(function* (
			input: Omit<Extract<CreateAnyEntityInput, { scope: "global" }>, "scope">,
		) {
			return yield* createEntity({ ...input, scope: "global" });
		});

		const update = Effect.fn("EntitiesService.update")(function* (input: UpdateEntityInput) {
			const scope = yield* runWithDb(repository.findEntitySchemaById(input.entitySchemaId));
			if (!scope) {
				return yield* notFound(entitySchemaNotFoundError);
			}

			const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);

			return yield* runWithDb(
				repository.updateEntity({
					properties,
					name: input.name,
					entityId: input.entityId,
					populatedAt: input.populatedAt,
				}),
			);
		});

		const upsert = Effect.fn("EntitiesService.upsert")(function* (input: UpsertEntityInput) {
			const scope = yield* runWithDb(repository.findEntitySchemaById(input.entitySchemaId));
			if (!scope) {
				return yield* notFound(entitySchemaNotFoundError);
			}

			const name = yield* requireText(input.name, "Entity name is required");
			const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);
			const saved = yield* runWithDb(
				repository.insertEntity({
					name,
					properties,
					scope: "global",
					externalId: input.externalId,
					populatedAt: input.populatedAt,
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
				}),
			);
			const before = toMutationSnapshot(saved.entity, scope.slug);

			if (saved.wasInserted) {
				return {
					entity: saved.entity,
					outcome: { before: null, after: before, operation: "create" as const },
				};
			}

			if (!input.updateExisting && saved.entity.populatedAt !== null) {
				return {
					entity: saved.entity,
					outcome: { before, after: before, operation: "noop" as const },
				};
			}

			const entity = yield* runWithDb(
				repository.updateEntity({
					name,
					properties,
					entityId: saved.entity.id,
					populatedAt: input.populatedAt,
				}),
			);
			const after = toMutationSnapshot(entity, scope.slug);
			const operation =
				before.name === after.name && Bun.deepEquals(before.properties, after.properties)
					? ("noop" as const)
					: ("update" as const);

			return { entity, outcome: { before, after, operation } };
		});

		const getById = Effect.fn("EntitiesService.getById")(function* (
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

			const response = yield* queryEngine.execute(
				user,
				buildEntityDetailQueryDocument({ entityId, entitySchemaSlug: scope.entitySchemaSlug }),
			);
			const rows = yield* requireRowsResponse(response);
			const row = rows.data.items[0];
			if (!row) {
				return yield* notFound(entityNotFoundError);
			}

			const entity = yield* toListedEntity(row);
			const translationStatus = yield* Schema.decodeUnknown(TranslationStatus)(
				yield* requireStringField(row, "translationStatus"),
			).pipe(Effect.orDie);

			return { ...entity, translationStatus } satisfies EntityDetail;
		});

		const getByIdAnyScope = Effect.fn("EntitiesService.getByIdAnyScope")(function* (
			entityId: EntityId,
		) {
			const entity = yield* runWithDb(repository.getById(entityId));
			if (!entity) {
				return yield* notFound(entityNotFoundError);
			}
			return entity;
		});

		const deleteByIds = Effect.fn("EntitiesService.deleteByIds")(function* (
			ids: readonly [EntityId, ...EntityId[]],
		) {
			return yield* runWithDb(repository.deleteByIds(ids));
		});

		const deleteBySandboxScript = Effect.fn("EntitiesService.deleteBySandboxScript")(function* (
			sandboxScriptId: SandboxScriptId,
		) {
			return yield* runWithDb(repository.deleteBySandboxScript(sandboxScriptId));
		});

		return {
			create,
			update,
			upsert,
			getById,
			deleteByIds,
			createGlobal,
			getByIdAnyScope,
			deleteBySandboxScript,
		};
	}),
}) {}
