import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { DateTime, Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { mediaFailureMessage } from "../lib/error-message";
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
	name: "Media Trending Refresh",
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
		itemCount: Schema.Finite,
		providerCount: Schema.Finite,
	}),
	run: (_input, host) =>
		Effect.gen(function* () {
			let providerCount = 0;
			const rankedItems: Array<{ entityId: string; rank: number }> = [];

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
									attributes: {
										error: mediaFailureMessage(error),
										providerSlug: provider.manifest.slug,
									},
								},
							])
							.pipe(
								Effect.orElseSucceed(() => null),
								Effect.map(() => ({ success: false as const })),
							),
					),
				);

				if (!result.success) {
					continue;
				}

				providerCount += 1;
				const entityIds = new Set(
					result.items.filter((item) => item.status === "upserted").map(({ entityId }) => entityId),
				);
				rankedItems.push(
					...[...entityIds].map((entityId, index) => ({ entityId, rank: index + 1 })),
				);
			}

			if (providerCount === 0) {
				return { itemCount: 0, synced: false, providerCount };
			}

			const fetchedAt = DateTime.formatIso(DateTime.nowUnsafe());
			yield* host.upsertGlobalRelationships([
				{
					selector: { type: "self" },
					relationshipSchemaSlug: "media-trending",
					relationships: rankedItems.map(({ rank, entityId }) => ({
						sourceEntityId: entityId,
						targetEntityId: entityId,
						properties: { rank, fetchedAt },
					})),
				},
			]);

			return { synced: true, providerCount, itemCount: rankedItems.length };
		}),
});
