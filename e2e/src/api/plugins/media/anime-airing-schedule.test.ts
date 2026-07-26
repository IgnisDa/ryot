import { animeAiringSoonRecipe } from "@ryot-app/media-plugin/shared/anime-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
} from "~/fixtures/kernel";
import { seedMediaEntity } from "~/fixtures/plugins/media";
import { describe, expect, it } from "~/support/effect-test";

const animeProperties = (airingSchedule: readonly { episode: number; airingAt: string }[]) => ({
	images: [],
	genres: [],
	isNsfw: null,
	sourceUrl: null,
	description: null,
	publishYear: null,
	publishDate: null,
	providerRating: null,
	productionStatus: null,
	episodes: airingSchedule.length,
	airingSchedule: [...airingSchedule],
});

describe("Anime airing schedule", () => {
	it.live("orders anime by the next episode airing after now", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "anime");
			const seedAnime = (
				name: string,
				airingSchedule: readonly { episode: number; airingAt: string }[],
			) =>
				seedMediaEntity({
					name,
					userId: null,
					providerId: null,
					entitySchemaSlug: schema.id,
					properties: animeProperties(airingSchedule),
					externalId: `anime-airing-${name}-${crypto.randomUUID()}`,
				});
			yield* Effect.all([
				seedAnime("Airing Later", [
					{ episode: 1, airingAt: "2026-08-01T00:00:00.000Z" },
					{ episode: 2, airingAt: "2026-09-10T00:00:00.000Z" },
					{ episode: 3, airingAt: "2026-09-25T00:00:00.000Z" },
				]),
				seedAnime("Airing First", [{ episode: 1, airingAt: "2026-09-03T00:00:00.000Z" }]),
				seedAnime("Airing Past", [{ episode: 1, airingAt: "2026-07-01T00:00:00.000Z" }]),
				seedAnime("Airing Empty", []),
			]);

			const airing = yield* executeRyotQLRecipe(
				client,
				animeAiringSoonRecipe({ now: "2026-09-01T00:00:00.000Z" }),
			);
			expect(airing.items.map((item) => [item.name, item.nextAiringAt, item.nextEpisode])).toEqual([
				["Airing First", "2026-09-03T00:00:00.000Z", 1],
				["Airing Later", "2026-09-10T00:00:00.000Z", 2],
			]);

			const advanced = yield* executeRyotQLRecipe(
				client,
				animeAiringSoonRecipe({ now: "2026-09-04T00:00:00.000Z" }),
			);
			expect(
				advanced.items.map((item) => [item.name, item.nextAiringAt, item.nextEpisode]),
			).toEqual([["Airing Later", "2026-09-10T00:00:00.000Z", 2]]);
		}),
	);
});
