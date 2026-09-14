import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { DateTime, Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import {
	manifest as movieTmdbManifest,
	trending as movieTmdbTrending,
} from "../providers/movie/tmdb/shared";
import {
	manifest as showTmdbManifest,
	trending as showTmdbTrending,
} from "../providers/show/tmdb/shared";

export const manifest = defineManifest({
	kind: "script",
	slug: "media-trending",
	requiredSystemConfigKeys: [],
	name: "Media Trending Refresh",
	requiredPluginConfigKeys: ["tmdbAccessToken"],
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
							items.map(({ name, externalId }) => ({
								name,
								externalId,
								properties: {},
								populatedAt: null,
								entitySchemaSlug: provider.entitySchemaSlug,
							})),
						),
					),
					Effect.map((items) => ({ items, success: true as const })),
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
				return { itemCount: 0, synced: false, providerCount };
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
						properties: { fetchedAt, rank: index + 1 },
					})),
				},
			]);

			return { synced: true, providerCount, itemCount: rankedItems.length };
		}),
});
