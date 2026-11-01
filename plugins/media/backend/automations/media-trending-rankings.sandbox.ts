import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { DateTime, Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import { trendingLatestMediaRecipe } from "../../shared/discovery-recipes";
import { MediaTrendingRankingsInput, MediaTrendingRankingsOutput } from "../contracts/workflows";

export const manifest = defineManifest({
	kind: "script",
	slug: "media-trending-rankings",
	name: "Media Trending Rankings",
});

export default defineScript({
	manifest,
	input: MediaTrendingRankingsInput,
	output: MediaTrendingRankingsOutput,
	run: ({ batches, failedEntitySchemaSlugs }, host) =>
		Effect.gen(function* () {
			if (batches.length === 0) {
				return { itemCount: 0, synced: false };
			}
			const fetchedAt = DateTime.formatIso(yield* DateTime.now);
			const relationships = batches.flatMap(({ entityIds }) =>
				entityIds.map((entityId, index) => ({
					sourceEntityId: entityId,
					targetEntityId: entityId,
					properties: { fetchedAt, rank: index + 1 },
				})),
			);
			const [firstFailedSlug, ...otherFailedSlugs] = failedEntitySchemaSlugs;
			if (firstFailedSlug !== undefined) {
				let after: string | undefined;
				let hasMore = true;
				while (hasMore) {
					const { items, pageInfo } = yield* executeRyotqlRecipe(
						host.executeRyotql,
						trendingLatestMediaRecipe({
							after,
							limit: 100,
							reference: { kind: "self" },
							entitySchemaSlugs: [firstFailedSlug, ...otherFailedSlugs],
						}),
					);
					for (const { id, rank, fetchedAt: previousFetchedAt } of items) {
						relationships.push({
							sourceEntityId: id,
							targetEntityId: id,
							properties: { rank, fetchedAt: previousFetchedAt },
						});
					}
					after = pageInfo.nextCursor ?? undefined;
					hasMore = pageInfo.hasMore;
				}
			}
			yield* host.upsertGlobalRelationships([
				{ relationships, selector: { type: "self" }, relationshipSchemaSlug: "media-trending" },
			]);
			return { synced: true, itemCount: relationships.length };
		}),
});
