import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { DateTime, Effect } from "@ryot-app/plugin-backend-sdk/effect";

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
	run: ({ batches }, host) =>
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
			yield* host.upsertGlobalRelationships([
				{ relationships, selector: { type: "self" }, relationshipSchemaSlug: "media-trending" },
			]);
			return { synced: true, itemCount: relationships.length };
		}),
});
