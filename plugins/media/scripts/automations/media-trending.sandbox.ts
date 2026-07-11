import { defineDriver, defineManifest } from "@ryot/sandbox-sdk/core";
import dayjs from "@ryot/sandbox-sdk/dayjs";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import {
	manifest as movieTmdbManifest,
	trending as movieTmdbTrending,
} from "../providers/media/movie/tmdb.sandbox";
import {
	manifest as showTmdbManifest,
	trending as showTmdbTrending,
} from "../providers/media/show/tmdb.sandbox";

export const manifest = defineManifest({
	kind: "provider",
	slug: "media-trending",
	name: "Media Trending Refresh",
	providerInformation: { source: "tmdb" },
	requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
	capabilities: [
		"log",
		"httpCall",
		"getAppConfigValue",
		"getUserPreferences",
		"upsertGlobalEntities",
		"upsertGlobalRelationships",
	],
});

const providers = [
	{ driver: showTmdbTrending, entitySchemaSlug: "show", manifest: showTmdbManifest },
	{ driver: movieTmdbTrending, entitySchemaSlug: "movie", manifest: movieTmdbManifest },
] as const;

export const cron = defineDriver(manifest, {
	input: Schema.Struct({}),
	output: Schema.Struct({
		synced: Schema.Boolean,
		itemCount: Schema.Number,
		providerCount: Schema.Number,
	}),
	run: (_input, host, execution) =>
		Effect.gen(function* () {
			let providerCount = 0;
			const savedItems: Array<{ entityId: string }> = [];

			for (const provider of providers) {
				const result = yield* provider.driver.run({}, host, execution).pipe(
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
					Effect.catchAll((error) =>
						host
							.log([
								{
									level: "warning",
									message: "trending provider skipped",
									attributes: { error: String(error), scriptSlug: provider.manifest.slug },
								},
							])
							.pipe(
								Effect.catchAll(() => Effect.succeed(null)),
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

			const fetchedAt = dayjs().toISOString();
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

export default defineProvider({ manifest, drivers: { cron } });
