import { upcomingRecipe } from "@ryot-app/media-plugin/shared/upcoming-recipes";
import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQLRecipe,
	listEventSchemas,
	requireEventSchemaBySlug,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	insertLibraryMembership,
	insertMediaMonitoring,
	seedMediaEntity,
	seedPodcast,
	seedShow,
	waitForLibrarySummary,
} from "~/fixtures/plugins/media";
import { describe, expect, it } from "~/support/effect-test";

const AIRED = "2020-01-01";

const today = new Date();

const dayOffset = (days: number) =>
	new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days))
		.toISOString()
		.slice(0, 10);

const instant = (days: number, time: string) => `${dayOffset(days)}T${time}.000Z`;

const loadSchemas = (client: Client) =>
	Effect.gen(function* () {
		const [episode, podcastEpisode, anime, movie] = yield* Effect.all([
			findMediaEntitySchema(client, "show-episode"),
			findMediaEntitySchema(client, "podcast-episode"),
			findMediaEntitySchema(client, "anime"),
			findMediaEntitySchema(client, "movie"),
		]);
		const [episodeEvents, podcastEvents, animeEvents] = yield* Effect.all([
			listEventSchemas(client, episode.schema.reference),
			listEventSchemas(client, podcastEpisode.schema.reference),
			listEventSchemas(client, anime.schema.reference),
		]);
		return {
			anime: anime.schema.id,
			movie: movie.schema.id,
			pluginId: anime.pluginId,
			animeProgress: requireEventSchemaBySlug(animeEvents, "progress").id,
			episodeComplete: requireEventSchemaBySlug(episodeEvents, "complete").id,
			podcastComplete: requireEventSchemaBySlug(podcastEvents, "complete").id,
		};
	});

type Schemas = Effect.Success<ReturnType<typeof loadSchemas>>;

const complete = (client: Client, eventSchemaSlug: string, entityId: string) =>
	createEventFixture(client, {
		entityId,
		eventSchemaSlug,
		properties: { dateUnknown: true },
		occurredAt: "2026-01-01T00:00:00.000Z",
	});

/** A library show whose season 1 episodes carry `publishDates` in order. */
const showWith = (client: Client, publishDates: readonly string[]) =>
	seedShow(client, {
		properties: { productionStatus: "Continuing" },
		seasons: [
			{
				seasonNumber: 1,
				episodes: publishDates.map((publishDate, index) => ({
					publishDate,
					episodeNumber: index + 1,
				})),
			},
		],
	});

const seedFlat = (
	schemaSlug: string,
	name: string,
	properties: Readonly<Record<string, unknown>>,
) =>
	seedMediaEntity({
		name,
		userId: null,
		providerId: null,
		entitySchemaSlug: schemaSlug,
		properties: { images: [], ...properties },
		externalId: `upcoming-${name}-${crypto.randomUUID()}`,
	});

const upcoming = (client: Client, schemas: Schemas, onePerTitle = true) =>
	executeRyotQLRecipe(
		client,
		upcomingRecipe({
			limit: 20,
			onePerTitle,
			fromDate: dayOffset(0),
			untilDate: dayOffset(14),
			fromInstant: instant(0, "00:00:00"),
			untilInstant: instant(15, "00:00:00"),
			reference: { kind: "local", pluginId: schemas.pluginId },
		}),
	);

const summarize = (titles: Effect.Success<ReturnType<typeof upcoming>>) =>
	titles.map(({ total, entity, occurrences }) => [
		entity.id,
		total,
		occurrences.map(({ airsAt }) => airsAt),
	]);

describe("Upcoming", () => {
	it.live("lists followed shows and podcasts at their soonest unwatched episodes", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadSchemas(client);
			const [caughtUp, monitored, untracked, outOfWindow, allWatched] = yield* Effect.all([
				showWith(client, [AIRED, dayOffset(3), dayOffset(3), dayOffset(5)]),
				showWith(client, [dayOffset(1)]),
				showWith(client, [dayOffset(2)]),
				showWith(client, [AIRED, dayOffset(20)]),
				showWith(client, [AIRED, dayOffset(4)]),
			]);
			const podcast = yield* seedPodcast(client, {
				episodes: [
					{ episodeNumber: 1, publishDate: AIRED },
					{ episodeNumber: 2, publishDate: dayOffset(2) },
				],
			});
			yield* insertMediaMonitoring(client, monitored.show.id);
			for (const [show, episodes] of [
				[caughtUp, [1]],
				[outOfWindow, [1]],
				[allWatched, [1, 2]],
			] as const) {
				for (const episode of episodes) {
					yield* complete(client, schemas.episodeComplete, show.episodeId(1, episode));
				}
			}
			const [podcastFirst] = podcast.episodes;
			if (podcastFirst === undefined) {
				throw new Error("Expected the first podcast episode");
			}
			yield* complete(client, schemas.podcastComplete, podcastFirst.id);
			yield* Effect.forEach(
				[
					...[caughtUp, monitored, untracked, outOfWindow, allWatched].map(({ show }) => show),
					podcast.podcast,
				],
				({ id }) => waitForLibrarySummary(client, id),
			);

			expect(summarize(yield* upcoming(client, schemas))).toEqual([
				[monitored.show.id, 1, [dayOffset(1)]],
				[caughtUp.show.id, 3, [dayOffset(3)]],
				[podcast.podcast.id, 1, [dayOffset(2)]],
			]);
			expect(summarize(yield* upcoming(client, schemas, false))).toContainEqual([
				caughtUp.show.id,
				3,
				[dayOffset(3), dayOffset(3), dayOffset(5)],
			]);
		}),
	);

	it.live("lists anime airings after the watched episode and monitored releases by date", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schemas = yield* loadSchemas(client);
			const animeWith = (name: string, publishDate: null | string, airings: readonly string[]) =>
				seedFlat(schemas.anime, name, {
					publishDate,
					episodes: airings.length,
					airingSchedule: airings.map((airingAt, index) => ({ airingAt, episode: index + 1 })),
				});
			const [watching, premiering, untrackedAnime, movie, unmonitoredMovie, laterMovie] =
				yield* Effect.all([
					animeWith("Watching", null, [
						instant(1, "12:00:00"),
						instant(2, "12:00:00"),
						instant(3, "12:00:00"),
					]),
					animeWith("Premiering", dayOffset(4), [instant(4, "00:00:00"), instant(11, "15:00:00")]),
					animeWith("Untracked", null, [instant(2, "09:00:00")]),
					seedFlat(schemas.movie, "Monitored", { publishDate: dayOffset(6) }),
					seedFlat(schemas.movie, "Unmonitored", { publishDate: dayOffset(6) }),
					seedFlat(schemas.movie, "Later", { publishDate: dayOffset(40) }),
				]);
			const all = [watching, premiering, untrackedAnime, movie, unmonitoredMovie, laterMovie];
			for (const entity of all) {
				yield* insertLibraryMembership(client, { mediaEntityId: entity.id });
			}
			for (const entity of [premiering, movie, laterMovie]) {
				yield* insertMediaMonitoring(client, entity.id);
			}
			yield* createEventFixture(client, {
				entityId: watching.id,
				properties: { animeEpisode: 1 },
				eventSchemaSlug: schemas.animeProgress,
				occurredAt: "2026-01-01T00:00:00.000Z",
			});
			yield* Effect.forEach(all, ({ id }) => waitForLibrarySummary(client, id));

			expect(summarize(yield* upcoming(client, schemas))).toEqual([
				[watching.id, 2, [instant(2, "12:00:00")]],
				[premiering.id, 1, [instant(11, "15:00:00")]],
				[premiering.id, 1, [dayOffset(4)]],
				[movie.id, 1, [dayOffset(6)]],
			]);
		}),
	);
});
