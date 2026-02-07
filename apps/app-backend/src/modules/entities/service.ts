import { Effect, Schema } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner } from "#lib/db/service";
import { badRequest, notFound } from "#lib/errors";
import { EntityId, EntitySchemaId, SandboxScriptId } from "#lib/schema/brands";
import { parseAppSchemaProperties } from "#lib/schema/property-schema-runtime";
import { requireText, trimToNull } from "#lib/validation";
import type { Expr, QueryDocument, RowItem, RowsOutput } from "#modules/query-engine/language";
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
import { TranslationStatus, type CreateEntityBody, type EntityDetail } from "./schemas";

type SaveEntityInput = SaveEntityInputBase & { properties: unknown };

const entityAlias = "entity";
const entityNotFoundError = "Entity not found";
const entitySchemaNotFoundError = "Entity schema not found";
const partialProvenanceError =
	"externalId and sandboxScriptId must both be provided or both be omitted";

const systemRef = (name: string): Expr => ({
	type: "ref",
	sourceAlias: entityAlias,
	field: { type: "system", name },
});

const literalExpr = (value: unknown): Expr => ({ type: "literal", value });

const translationStatusRef: Expr = {
	type: "ref",
	sourceAlias: entityAlias,
	field: { type: "systemComputed", name: "translationStatus" },
};

const entityFields = [
	{ key: "id", expr: systemRef("id") },
	{ key: "name", expr: systemRef("name") },
	{ key: "createdAt", expr: systemRef("createdAt") },
	{ key: "updatedAt", expr: systemRef("updatedAt") },
	{ key: "properties", expr: systemRef("properties") },
	{ key: "externalId", expr: systemRef("externalId") },
	{ key: "populatedAt", expr: systemRef("populatedAt") },
	{ key: "entitySchemaId", expr: systemRef("entitySchemaId") },
	{ key: "sandboxScriptId", expr: systemRef("sandboxScriptId") },
	{ key: "translationStatus", expr: translationStatusRef },
] satisfies RowsOutput["fields"];

const buildEntityByIdDocument = (input: { entityId: EntityId; entitySchemaSlug: string }) =>
	({
		output: {
			type: "rows",
			fields: entityFields,
			pagination: { page: 1, limit: 1 },
			orderBy: [{ order: "asc", expr: systemRef("id") }],
		},
		source: {
			type: "entities",
			alias: entityAlias,
			schemas: [input.entitySchemaSlug],
			where: {
				type: "comparison",
				operator: "eq",
				left: systemRef("id"),
				right: literalExpr(input.entityId),
			},
		},
	}) satisfies QueryDocument;

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
				buildEntityByIdDocument({ entityId, entitySchemaSlug: scope.entitySchemaSlug }),
			);
			const rows = yield* requireRowsResponse(response);
			const row = rows.data.items[0];
			if (!row) {
				return yield* notFound(entityNotFoundError);
			}

			// Localization comes from the query engine's entity source; translation status comes from the
			// query engine's computed field. Population and translation are driven by client interest.
			const entity = yield* toListedEntity(row);
			const translationStatus = yield* Schema.decodeUnknown(TranslationStatus)(
				yield* requireStringField(row, "translationStatus"),
			).pipe(Effect.orDie);

			return { ...entity, translationStatus } satisfies EntityDetail;
		});

		return { save, create, getById };
	}),
}) {}
