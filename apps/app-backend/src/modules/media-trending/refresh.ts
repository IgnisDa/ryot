import { Activity } from "@effect/workflow";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import { EntityId } from "@ryot/contract/schema/brands";
import { Cause, DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { EntitiesService } from "#modules/entities/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { MediaTrendingWorkflowOperations } from "./operations-workflow";
import { MediaTrendingRepository } from "./repository";
import type { TrendingDriverItem } from "./schemas";
import { TrendingProviderTarget } from "./schemas";

export type MediaTrendingRefreshInput = {
	executionId: string;
};

const SavedTrendingItem = Schema.Struct({
	entityId: EntityId,
	fetchedAt: Schema.String,
});

type SavedTrendingItem = typeof SavedTrendingItem.Type;

const RankedTrendingItem = Schema.Struct({
	rank: Schema.Number,
	entityId: EntityId,
	fetchedAt: Schema.String,
});

type RankedTrendingItem = typeof RankedTrendingItem.Type;

const providerActivityName = (prefix: string, provider: TrendingProviderTarget) =>
	`${prefix}-${provider.entitySchemaSlug}-${provider.scriptSlug}`;

const toSandboxRunError = (error: unknown) =>
	new SandboxRunError({ message: unknownToMessage(error) });

const listProviderTargets = Effect.fn("listMediaTrendingProviderTargets")(function* () {
	const runWithDb = yield* DbRunner;
	const repository = yield* MediaTrendingRepository;

	return yield* Activity.make({
		error: SandboxRunError,
		name: "list-media-trending-provider-targets",
		success: Schema.Array(TrendingProviderTarget),
		execute: runWithDb(repository.listProviderTargets()).pipe(Effect.mapError(toSandboxRunError)),
	});
});

const writeProviderTrendingItems = Effect.fn("writeProviderTrendingItems")(function* (input: {
	provider: TrendingProviderTarget;
	items: ReadonlyArray<TrendingDriverItem>;
}) {
	const entities = yield* EntitiesService;

	return yield* Activity.make({
		error: SandboxRunError,
		success: Schema.Array(SavedTrendingItem),
		name: providerActivityName("write-media-trending-items", input.provider),
		execute: Effect.gen(function* () {
			const savedItems: SavedTrendingItem[] = [];
			const fetchedAt = yield* DateTime.nowAsDate;

			for (const item of input.items) {
				const entity = yield* entities.create({
					properties: {},
					scope: "global",
					name: item.name,
					populatedAt: null,
					externalId: item.externalId,
					sandboxScriptId: input.provider.scriptId,
					entitySchemaId: input.provider.entitySchemaId,
				});

				savedItems.push({
					entityId: entity.id,
					fetchedAt: fetchedAt.toISOString(),
				});
			}

			return savedItems;
		}).pipe(Effect.mapError(toSandboxRunError)),
	});
});

const rankTrendingItems = (items: ReadonlyArray<SavedTrendingItem>) => {
	const byEntityId = new Map<string, SavedTrendingItem>();
	for (const item of items) {
		if (!byEntityId.has(item.entityId)) {
			byEntityId.set(item.entityId, item);
		}
	}

	return [...byEntityId.values()].map(
		(item, index): RankedTrendingItem => ({
			rank: index + 1,
			entityId: item.entityId,
			fetchedAt: item.fetchedAt,
		}),
	);
};

const syncTrendingEdges = Effect.fn("syncTrendingEdges")(function* (
	items: ReadonlyArray<RankedTrendingItem>,
) {
	const runWithDb = yield* DbRunner;
	const relationships = yield* RelationshipsRepository;
	const relationshipSchemas = yield* RelationshipSchemasRepository;

	return yield* Activity.make({
		success: Schema.Void,
		error: SandboxRunError,
		name: "sync-media-trending-edges",
		execute: Effect.gen(function* () {
			const mediaTrending = yield* runWithDb(
				relationshipSchemas.findBuiltinBySlug("media-trending"),
			);
			if (!mediaTrending) {
				return yield* new SandboxRunError({ message: "media-trending schema not found" });
			}

			yield* runWithDb(
				relationships.syncGlobalRelationships({
					type: "self",
					onConflict: "replaceProperties",
					synchronization: "authoritative",
					relationshipSchemaId: mediaTrending.id,
					entries: items.map((item) => ({
						entityId: item.entityId,
						properties: { rank: item.rank, fetchedAt: item.fetchedAt },
					})),
				}),
			);

			return undefined;
		}).pipe(Effect.mapError(toSandboxRunError)),
	});
});

const fetchProviderTrendingItems = Effect.fn("fetchProviderTrendingItems")(function* (input: {
	executionId: string;
	provider: TrendingProviderTarget;
}) {
	const operations = yield* MediaTrendingWorkflowOperations;
	const activityName = providerActivityName("fetch-media-trending", input.provider);

	const fetched = yield* operations.fetchTrending({
		scriptId: input.provider.scriptId,
		executionId: `${input.executionId}-${activityName}`,
	});

	return yield* writeProviderTrendingItems({
		items: fetched,
		provider: input.provider,
	});
});

export const runMediaTrendingRefresh = Effect.fn("runMediaTrendingRefresh")(function* (
	payload: MediaTrendingRefreshInput,
) {
	let providerCount = 0;
	const savedItems: SavedTrendingItem[] = [];
	const providers = yield* listProviderTargets();

	for (const provider of providers) {
		const result = yield* fetchProviderTrendingItems({
			provider,
			executionId: payload.executionId,
		}).pipe(Effect.exit);

		if (result._tag === "Failure") {
			yield* Effect.logWarning(
				`Skipping trending provider ${provider.scriptSlug}: ${unknownToMessage(Cause.squash(result.cause))}`,
			);
			continue;
		}

		providerCount += 1;
		savedItems.push(...result.value);
	}

	if (providerCount === 0) {
		return { providerCount, itemCount: 0, synced: false };
	}

	const rankedItems = rankTrendingItems(savedItems);
	yield* syncTrendingEdges(rankedItems);

	return {
		synced: true,
		providerCount,
		itemCount: rankedItems.length,
	};
});
