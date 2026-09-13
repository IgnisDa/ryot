import { animeAiringSoonRecipe } from "@ryot-app/media-plugin/shared/airing-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	listEventSchemas,
	requireEventSchemaBySlug,
} from "~/fixtures/kernel";
import {
	insertLibraryMembership,
	insertMediaMonitoring,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { describe, expect, it } from "~/support/effect-test";

type ScheduleEntry = { readonly episode: number; readonly airingAt: string };

const animeProperties = (
	airingSchedule: readonly ScheduleEntry[],
	publishDate: string | null = null,
) => ({
	images: [],
	genres: [],
	publishDate,
	isNsfw: null,
	sourceUrl: null,
	description: null,
	publishYear: null,
	providerRating: null,
	productionStatus: null,
	episodes: airingSchedule.length,
	airingSchedule: [...airingSchedule],
});

describe("Anime airing schedule", () => {
	it.live("lists followed anime by the next episode airing inside the window", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "anime");
			const progressSlug = requireEventSchemaBySlug(
				yield* listEventSchemas(client, schema.id),
				"progress",
			).id;
			const seedAnime = (
				name: string,
				airingSchedule: readonly ScheduleEntry[],
				publishDate: string | null = null,
			) =>
				seedMediaEntity({
					name,
					userId: null,
					providerId: null,
					entitySchemaSlug: schema.id,
					properties: animeProperties(airingSchedule, publishDate),
					externalId: `anime-airing-${name}-${crypto.randomUUID()}`,
				});
			const [watching, monitored, premiere, untracked, outsideWindow, notInLibrary] =
				yield* Effect.all([
					seedAnime("Airing Watching", [
						{ episode: 1, airingAt: "2026-08-01T00:00:00.000Z" },
						{ episode: 2, airingAt: "2026-09-10T12:00:00.000Z" },
						{ episode: 3, airingAt: "2026-09-10T12:00:00.000Z" },
						{ episode: 4, airingAt: "2026-09-17T12:00:00.000Z" },
					]),
					seedAnime("Airing Monitored", [{ episode: 5, airingAt: "2026-09-03T09:00:00.000Z" }]),
					seedAnime(
						"Airing Premiere",
						[{ episode: 1, airingAt: "2026-09-12T00:00:00.000Z" }],
						"2026-09-12",
					),
					seedAnime("Airing Untracked", [{ episode: 1, airingAt: "2026-09-04T00:00:00.000Z" }]),
					seedAnime("Airing Later", [{ episode: 1, airingAt: "2026-09-20T00:00:00.000Z" }]),
					seedAnime("Airing Unfollowed", [{ episode: 1, airingAt: "2026-09-05T00:00:00.000Z" }]),
				]);
			yield* Effect.all([
				insertLibraryMembership(client, { mediaEntityId: watching.id }),
				insertLibraryMembership(client, { mediaEntityId: monitored.id }),
				insertLibraryMembership(client, { mediaEntityId: premiere.id }),
				insertLibraryMembership(client, { mediaEntityId: untracked.id }),
				insertLibraryMembership(client, { mediaEntityId: outsideWindow.id }),
				insertMediaMonitoring(client, monitored.id),
				insertMediaMonitoring(client, notInLibrary.id),
			]);
			for (const anime of [watching, premiere, outsideWindow]) {
				yield* createEventFixture(client, {
					entityId: anime.id,
					eventSchemaSlug: progressSlug,
					occurredAt: "2026-08-02T00:00:00.000Z",
					properties: { animeEpisode: 1, progressPercent: 10 },
				});
			}

			const airing = yield* executeRyotQLRecipe(
				client,
				animeAiringSoonRecipe({
					now: "2026-09-01T00:00:00.000Z",
					until: "2026-09-16T00:00:00.000Z",
					fromDate: "2026-09-01",
					untilDate: "2026-09-15",
				}),
			);
			expect(
				airing.map((item) => [
					item.entity.id,
					item.airsAt,
					item.dateOnly,
					item.episodeLabel,
					item.sameDayCount,
				]),
			).toEqual([
				[monitored.id, "2026-09-03T09:00:00.000Z", false, "Episode 5", 1],
				[watching.id, "2026-09-10T12:00:00.000Z", false, "Episode 2", 2],
				[premiere.id, "2026-09-12", true, "Episode 1", 1],
			]);

			const advanced = yield* executeRyotQLRecipe(
				client,
				animeAiringSoonRecipe({
					now: "2026-09-11T00:00:00.000Z",
					until: "2026-09-26T00:00:00.000Z",
					fromDate: "2026-09-11",
					untilDate: "2026-09-25",
				}),
			);
			expect(advanced.map((item) => [item.entity.id, item.episodeLabel])).toEqual([
				[premiere.id, "Episode 1"],
				[watching.id, "Episode 4"],
				[outsideWindow.id, "Episode 1"],
			]);

			const westOfUtcDay = (day: string, now: string, until: string) =>
				executeRyotQLRecipe(
					client,
					animeAiringSoonRecipe({ now, until, fromDate: day, untilDate: day }),
				).pipe(Effect.map((items) => items.map((item) => item.entity.id)));
			expect(
				yield* westOfUtcDay("2026-09-11", "2026-09-11T04:00:00.000Z", "2026-09-12T04:00:00.000Z"),
			).toEqual([]);
			expect(
				yield* westOfUtcDay("2026-09-12", "2026-09-12T04:00:00.000Z", "2026-09-13T04:00:00.000Z"),
			).toEqual([premiere.id]);
		}),
	);
});
