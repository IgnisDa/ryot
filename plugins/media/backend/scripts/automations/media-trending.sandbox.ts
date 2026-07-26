import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Schema } from "@ryot/sandbox-sdk/effect";

import {
	manifest as movieTmdbManifest,
	trending as movieTmdbTrending,
} from "../providers/media/movie/tmdb";
import {
	manifest as showTmdbManifest,
	trending as showTmdbTrending,
} from "../providers/media/show/tmdb";

export const manifest = defineManifest({
	kind: "script",
	slug: "media-trending",
	name: "Media Trending Refresh",
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
	capabilities: [
		"log",
		"httpCall",
		"getPluginConfig",
		"upsertGlobalEntities",
		"upsertGlobalRelationships",
	],
});

const providers = [
	{ script: showTmdbTrending, entitySchemaSlug: "show", manifest: showTmdbManifest },
	{ script: movieTmdbTrending, entitySchemaSlug: "movie", manifest: movieTmdbManifest },
] as const;

export default defineScript({
	manifest,
	input: Schema.Struct({}),
	output: Schema.Struct({
		synced: Schema.Boolean,
		itemCount: Schema.Number,
		providerCount: Schema.Number,
	}),
	run: (_input, host) =>
		Effect.gen(function* () {
			let providerCount = 0;
			const savedItems: Array<{ entityId: string }> = [];

			for (const provider of providers) {
				const result = yield* provider.script.run({}, host).pipe(
					Effect.flatMap(({ items }) =>
						host.upsertGlobalEntities(
							items.map(({ externalId, name }) => ({
								name,
								externalId,
								properties: {},
								populatedAt: null,
								entitySchemaSlug: provider.entitySchemaSlug,
							})),
						),
					),
					Effect.map((items) => ({ success: true as const, items })),
					Effect.catch((error) =>
						host
							.log([
								{
									level: "warning",
									message: "trending provider skipped",
									attributes: { error: String(error), providerSlug: provider.manifest.slug },
								},
							])
							.pipe(
								Effect.catch(() => Effect.succeed(null)),
								Effect.map(() => ({ success: false as const })),
							),
					),
				);

				if (!result.success) {
					continue;
				}

				providerCount += 1;
				savedItems.push(
					...result.items
						.filter((item) => item.status === "upserted")
						.map(({ entityId }) => ({ entityId })),
				);
			}

			if (providerCount === 0) {
				return { synced: false, itemCount: 0, providerCount };
			}

			const fetchedAt = DateTime.formatIso(DateTime.nowUnsafe());
			const rankedItemsByEntityId = new Map<string, (typeof savedItems)[number]>();
			for (const item of savedItems) {
				if (!rankedItemsByEntityId.has(item.entityId)) {
					rankedItemsByEntityId.set(item.entityId, item);
				}
			}
			const rankedItems = [...rankedItemsByEntityId.values()];
			yield* host.upsertGlobalRelationships([
				{
					selector: { type: "self" },
					relationshipSchemaSlug: "media-trending",
					relationships: rankedItems.map(({ entityId }, index) => ({
						sourceEntityId: entityId,
						targetEntityId: entityId,
						properties: { rank: index + 1, fetchedAt },
					})),
				},
			]);

			return { synced: true, providerCount, itemCount: rankedItems.length };
		}),
});
