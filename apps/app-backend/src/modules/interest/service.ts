import { Effect, Schema } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner } from "#lib/db/service";
import type { EntityUpdatedReason } from "#lib/redis";
import { EntityId, EntitySchemaId, SandboxScriptId } from "#lib/schema/brands";
import { EntityPopulationTrigger } from "#modules/entities/population-trigger";
import { TranslationStatus } from "#modules/entities/schemas";
import { loadVisibleEntitySchemaSlugs } from "#modules/query-engine/executor/schema-loaders";
import type { Expr, QueryDocument, RowItem } from "#modules/query-engine/language";
import {
	getOptionalIsoStringField,
	getOptionalStringField,
	requireFieldValue,
	requireRowsResponse,
	requireStringField,
} from "#modules/query-engine/response-helpers";
import { QueryEngineService } from "#modules/query-engine/service";
import { MAX_ROOT_PAGE_SIZE } from "#modules/query-engine/validator/shared";
import { TranslationsService } from "#modules/translations/service";

const ENTITY_ALIAS = "entity";

const systemRef = (name: string): Expr => ({
	type: "ref",
	sourceAlias: ENTITY_ALIAS,
	field: { type: "system", name },
});

const schemaSlugRef: Expr = {
	type: "ref",
	sourceAlias: ENTITY_ALIAS,
	field: { type: "schema", name: "slug" },
};

const translationStatusRef: Expr = {
	type: "ref",
	sourceAlias: ENTITY_ALIAS,
	field: { type: "systemComputed", name: "translationStatus" },
};

const interestFields = [
	{ key: "id", expr: systemRef("id") },
	{ key: "populatedAt", expr: systemRef("populatedAt") },
	{ key: "externalId", expr: systemRef("externalId") },
	{ key: "properties", expr: systemRef("properties") },
	{ key: "schemaSlug", expr: schemaSlugRef },
	{ key: "entitySchemaId", expr: systemRef("entitySchemaId") },
	{ key: "sandboxScriptId", expr: systemRef("sandboxScriptId") },
	{ key: "translationStatus", expr: translationStatusRef },
];

const idEq = (entityId: string): Expr => ({
	operator: "eq",
	type: "comparison",
	left: systemRef("id"),
	right: { type: "literal", value: entityId },
});

const chunk = <T>(items: readonly T[], size: number): T[][] => {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
};

const buildInterestDocument = (
	entityIds: readonly [string, ...string[]],
	schemas: readonly [string, ...string[]],
): QueryDocument => {
	const [firstId, ...restIds] = entityIds;
	const where: Expr =
		restIds.length === 0
			? idEq(firstId)
			: { type: "or", values: [idEq(firstId), ...restIds.map(idEq)] };
	return {
		source: { type: "entities", alias: ENTITY_ALIAS, schemas, where },
		output: {
			type: "rows",
			fields: interestFields,
			pagination: { page: 1, limit: entityIds.length },
			orderBy: [{ order: "asc", expr: systemRef("id") }],
		},
	};
};

type TerminalUpdate = { readonly entityId: EntityId; readonly reason: EntityUpdatedReason };

type InterestRow = {
	readonly id: EntityId;
	readonly schemaSlug: string;
	readonly properties: unknown;
	readonly externalId: string | null;
	readonly populatedAt: string | null;
	readonly entitySchemaId: EntitySchemaId;
	readonly translationStatus: TranslationStatus;
	readonly sandboxScriptId: SandboxScriptId | null;
};

const toInterestRow = Effect.fn("toInterestRow")(function* (row: RowItem) {
	const sandboxScriptId = yield* getOptionalStringField(row, "sandboxScriptId");
	const translationStatus = yield* Schema.decodeUnknown(TranslationStatus)(
		yield* requireStringField(row, "translationStatus"),
	).pipe(Effect.orDie);
	return {
		translationStatus,
		schemaSlug: yield* requireStringField(row, "schemaSlug"),
		id: EntityId.make(yield* requireStringField(row, "id")),
		externalId: yield* getOptionalStringField(row, "externalId"),
		properties: (yield* requireFieldValue(row, "properties")).value,
		populatedAt: yield* getOptionalIsoStringField(row, "populatedAt"),
		sandboxScriptId: sandboxScriptId ? SandboxScriptId.make(sandboxScriptId) : null,
		entitySchemaId: EntitySchemaId.make(yield* requireStringField(row, "entitySchemaId")),
	} satisfies InterestRow;
});

export class InterestReconciler extends Effect.Service<InterestReconciler>()("InterestReconciler", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const queryEngine = yield* QueryEngineService;
		const translations = yield* TranslationsService;
		const populationTrigger = yield* EntityPopulationTrigger;

		const handleRow = (
			user: CurrentUserValue,
			row: InterestRow,
		): Effect.Effect<TerminalUpdate | null> =>
			Effect.gen(function* () {
				if (row.populatedAt === null) {
					if (row.externalId !== null && row.sandboxScriptId !== null) {
						yield* populationTrigger.request({
							userId: user.id,
							entityId: row.id,
							externalId: row.externalId,
							entitySchemaId: row.entitySchemaId,
							sandboxScriptId: row.sandboxScriptId,
						});
						return null;
					}
					return { entityId: row.id, reason: "populated" };
				}

				if (row.translationStatus === "pending") {
					if (
						user.preferences.language !== null &&
						row.externalId !== null &&
						row.sandboxScriptId !== null
					) {
						yield* translations.requestFill({
							entityId: row.id,
							externalId: row.externalId,
							properties: row.properties,
							scriptId: row.sandboxScriptId,
							entitySchemaSlug: row.schemaSlug,
							language: user.preferences.language,
						});
					}
					return null;
				}

				return {
					entityId: row.id,
					reason: row.translationStatus === "ready" ? "translated" : "populated",
				};
			});

		const reconcile = Effect.fn("InterestReconciler.reconcile")(function* (
			user: CurrentUserValue,
			entityIds: readonly string[],
		) {
			if (entityIds.length === 0) {
				return [] as TerminalUpdate[];
			}
			const slugs = yield* runWithDb(loadVisibleEntitySchemaSlugs(user.id));
			const [firstSlug, ...restSlugs] = slugs;
			if (firstSlug === undefined) {
				return [] as TerminalUpdate[];
			}
			const schemas: [string, ...string[]] = [firstSlug, ...restSlugs];

			const terminal: TerminalUpdate[] = [];
			for (const ids of chunk(entityIds, MAX_ROOT_PAGE_SIZE)) {
				const [firstId, ...restIds] = ids;
				if (firstId === undefined) {
					continue;
				}
				const doc = buildInterestDocument([firstId, ...restIds], schemas);
				const response = yield* queryEngine.execute(user, doc);
				const rows = yield* requireRowsResponse(response);
				for (const item of rows.data.items) {
					const result = yield* handleRow(user, yield* toInterestRow(item));
					if (result) {
						terminal.push(result);
					}
				}
			}
			return terminal;
		});

		return { reconcile };
	}),
}) {}
