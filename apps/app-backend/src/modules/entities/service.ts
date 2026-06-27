import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import {
	TranslationStatus,
	type CreateEntityBody,
	type EntityDetail,
} from "@ryot/contract/modules/entities/schemas";
import type { RowItem } from "@ryot/contract/modules/query-engine/language";
import { EntityId, EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
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

import { EntitiesRepository, type SaveEntityInputBase } from "./repository";

type SaveEntityInput = SaveEntityInputBase & { properties: unknown };

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

		const save = Effect.fn("EntitiesService.save")(function* (input: SaveEntityInput) {
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

			return yield* runWithDb(repository.saveEntity({ ...input, properties }));
		});

		const create = Effect.fn("EntitiesService.create")(function* (
			user: CurrentUserValue,
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

			return yield* save({
				name,
				scope: "user",
				entitySchemaId,
				userId: user.id,
				properties: payload.properties,
				...provenance,
			});
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
