import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { TranslationStatus } from "@ryot/contract/modules/entities/schemas";
import {
	type DeclareInterestBody,
	type EntityUpdatedReason,
	MAX_INTEREST_ENTITY_IDS,
} from "@ryot/contract/modules/entity-interest/messages";
import type { RowItem } from "@ryot/contract/modules/query-engine/language";
import {
	EntityId,
	EntitySchemaSlug,
	SandboxScriptId,
	type UserId,
} from "@ryot/contract/schema/brands";
import { buildEntityInterestQueryDocument } from "@ryot/query-engine/recipes/app";
import { Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { EntityPopulationTrigger } from "#modules/entities/population-trigger";
import { TranslationsService } from "#modules/entity-translation/service";
import { loadVisibleEntitySchemaSlugs } from "#modules/query-engine/executor/schema-loaders";
import {
	getOptionalIsoStringField,
	getOptionalStringField,
	requireFieldValue,
	requireRowsResponse,
	requireStringField,
} from "#modules/query-engine/response-helpers";
import { QueryEngineService } from "#modules/query-engine/service";
import { MAX_ROOT_PAGE_SIZE } from "#modules/query-engine/validator/shared";

import { StreamRegistry } from "./registry";

const chunk = <T>(items: readonly T[], size: number): T[][] => {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
};

type TerminalUpdate = { readonly entityId: EntityId; readonly reason: EntityUpdatedReason };

type InterestRow = {
	readonly id: EntityId;
	readonly schemaSlug: string;
	readonly properties: unknown;
	readonly externalId: string | null;
	readonly populatedAt: string | null;
	readonly entitySchemaSlug: EntitySchemaSlug;
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
		entitySchemaSlug: EntitySchemaSlug.make(yield* requireStringField(row, "entitySchemaSlug")),
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
							origin: { kind: "api" },
							externalId: row.externalId,
							entitySchemaSlug: row.entitySchemaSlug,
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
				const doc = buildEntityInterestQueryDocument({
					entityIds: [firstId, ...restIds],
					entitySchemaSlugs: schemas,
				});
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

export class InterestService extends Effect.Service<InterestService>()("InterestService", {
	effect: Effect.gen(function* () {
		const registry = yield* StreamRegistry;
		const reconciler = yield* InterestReconciler;

		const setInterest = Effect.fn("InterestService.setInterest")(function* (input: {
			userId: UserId;
			streamId: string;
			entityIds: readonly string[];
		}) {
			const entityIds = input.entityIds.slice(0, MAX_INTEREST_ENTITY_IDS);
			if (entityIds.length < input.entityIds.length) {
				yield* Effect.logWarning("interest set truncated").pipe(
					Effect.annotateLogs({
						streamId: input.streamId,
						cap: MAX_INTEREST_ENTITY_IDS,
						declared: input.entityIds.length,
					}),
				);
			}
			yield* registry.setInterestIfOwner(input.streamId, input.userId, entityIds);
			return entityIds;
		});

		const declareInterest = Effect.fn("InterestService.declareInterest")(function* (
			user: CurrentUserValue,
			payload: DeclareInterestBody,
		) {
			const entityIds = yield* setInterest({
				userId: user.id,
				streamId: payload.streamId,
				entityIds: payload.entityIds,
			});
			const terminal = yield* reconciler
				.reconcile(user, entityIds)
				.pipe(
					Effect.catchAll((error) =>
						Effect.logWarning("interest reconcile failed", error).pipe(Effect.as([])),
					),
				);
			return {
				terminal: terminal.filter((update) =>
					registry.hasInterest(payload.streamId, update.entityId),
				),
			};
		});

		return { setInterest, declareInterest };
	}),
}) {}
