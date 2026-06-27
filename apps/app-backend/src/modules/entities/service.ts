import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import {
	TranslationStatus,
	type CreateEntityBody,
	type EntityDetail,
	type ListedEntity,
} from "@ryot/contract/modules/entities/schemas";
import type { RowItem } from "@ryot/contract/modules/query-engine/language";
import {
	EntityId,
	EntitySchemaId,
	SandboxScriptId,
	type UserId,
} from "@ryot/contract/schema/brands";
import { buildEntityDetailQueryDocument } from "@ryot/query-engine";
import { Effect, Schema } from "effect";

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

import { EntitiesRepository } from "./repository";
import type { SaveEntityInputBase } from "./repository-types";

type SaveEntityInput = SaveEntityInputBase & { properties: unknown };

export type EntityCreateResult = {
	entity: ListedEntity;
	entitySchemaSlug: string;
	operation: "create" | "update" | "noop";
};

const entityNotFoundError = "Entity not found";
const entitySchemaNotFoundError = "Entity schema not found";
const partialProvenanceError =
	"externalId and sandboxScriptId must both be provided or both be omitted";

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

		const prepareSaveInput = Effect.fn("EntitiesService.prepareSaveInput")(function* (
			input: SaveEntityInput,
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

			const properties = yield* parseAppSchemaProperties({
				kind: "Entity",
				properties: input.properties,
				propertiesSchema: scope.propertiesSchema,
			}).pipe(Effect.mapError((error) => badRequest(error.message)));

			return { ...input, properties };
		});

		const save = Effect.fn("EntitiesService.save")(function* (input: SaveEntityInput) {
			const prepared = yield* prepareSaveInput(input);
			return yield* runWithDb(repository.saveEntity(prepared));
		});

		const prepareApiCreate = Effect.fn("EntitiesService.prepareApiCreate")(function* (
			userId: UserId,
			payload: CreateEntityBody,
		) {
			const externalId = payload.externalId ? trimToNull(payload.externalId) : null;
			const trimmedScriptId = payload.sandboxScriptId ? trimToNull(payload.sandboxScriptId) : null;
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
				repository.getEntitySchemaScopeForUser({ userId, entitySchemaId }),
			);
			if (!scope) {
				return yield* notFound(entitySchemaNotFoundError);
			}

			const provenance = externalId && sandboxScriptId ? { externalId, sandboxScriptId } : null;

			if (provenance) {
				const existing = yield* runWithDb(
					repository.findEntityByExternalIdForUser({
						userId,
						entitySchemaId,
						externalId: provenance.externalId,
						sandboxScriptId: provenance.sandboxScriptId,
					}),
				);
				if (existing) {
					return { kind: "existing" as const, entity: existing, entitySchemaSlug: scope.slug };
				}
			}

			const name = yield* requireText(payload.name, "Entity name is required");

			return {
				kind: "create" as const,
				entitySchemaSlug: scope.slug,
				input: {
					name,
					userId,
					entitySchemaId,
					scope: "user" as const,
					properties: payload.properties,
					...provenance,
				} satisfies SaveEntityInput,
			};
		});

		const create = Effect.fn("EntitiesService.create")(function* (
			userId: UserId,
			payload: CreateEntityBody,
		) {
			const prepared = yield* prepareApiCreate(userId, payload);
			if (prepared.kind === "existing") {
				return {
					operation: "noop",
					entity: prepared.entity,
					entitySchemaSlug: prepared.entitySchemaSlug,
				} satisfies EntityCreateResult;
			}
			const outcome = yield* save(prepared.input);
			return {
				entity: outcome.entity,
				operation: outcome.operation,
				entitySchemaSlug: prepared.entitySchemaSlug,
			} satisfies EntityCreateResult;
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

		return { save, create, getById };
	}),
}) {}
