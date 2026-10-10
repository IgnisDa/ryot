import {
	calendarOccurrencesPageRecipe,
	calendarSourcesRecipe,
	type CalendarOccurrence,
} from "@ryot-app/ryotql-recipes/calendar";
import { Effect, Result } from "effect";

import {
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQLRecipe,
	listEventSchemas,
	requireEventSchemaBySlug,
	type Client,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	insertLibraryMembership,
	seedLibraryPodcastEpisodes,
	seedLibraryShowEpisodes,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const window = {
	month: "2026-09",
	localEnd: "2026-10-01T00:00:00.000Z",
	localStart: "2026-09-01T00:00:00.000Z",
};

const remoteAsset = (name: string) => ({
	type: "remote" as const,
	url: `https://img.example/${name}`,
});

const coverImage = (name: string) => ({ ...remoteAsset(name), purpose: "cover" });

const occurrences = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const sources = yield* executeRyotQLRecipe(client, calendarSourcesRecipe());
		const source = sources.find((candidate) => candidate.slug === slug);
		if (source === undefined) {
			throw new Error(`Missing calendar source '${slug}'`);
		}
		return yield* collectRyotQLRecipeItems(client, (after) =>
			Result.getOrThrow(calendarOccurrencesPageRecipe({ after, source, window })),
		);
	});

const summary = (items: readonly CalendarOccurrence[]) =>
	items.map(({ art, done, caption, startAt, subject }) => ({
		art,
		done,
		caption,
		startAt,
		subject: subject.id,
	}));

const eventSlug = (client: Client, schemaSlug: string, eventSlugName: string) =>
	Effect.gen(function* () {
		const { schema } = yield* findMediaEntitySchema(client, schemaSlug);
		return requireEventSchemaBySlug(
			yield* listEventSchemas(client, schema.reference),
			eventSlugName,
		).id;
	});

const seedRelease = (schemaId: string, name: string, properties: Record<string, unknown>) =>
	seedMediaEntity({
		properties,
		userId: null,
		providerId: null,
		entitySchemaSlug: schemaId,
		name: `${name} ${crypto.randomUUID()}`,
		externalId: `calendar-${name}-${crypto.randomUUID()}`,
	});

const expectedAirings = (first: boolean, second: boolean) => [
	{
		done: first,
		caption: "Episode 2",
		art: remoteAsset("anime.jpg"),
		startAt: "2026-09-13T14:30:00.000Z",
	},
	{
		done: second,
		caption: "Episode 3",
		art: remoteAsset("anime.jpg"),
		startAt: "2026-09-20T14:30:00.000Z",
	},
];

describe("Media calendar sources", () => {
	it.live("lists in-library show episodes and specials with art fallback and done marks", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const complete = yield* eventSlug(client, "show-episode", "complete");
			const { show, episodes } = yield* seedLibraryShowEpisodes(client, {
				images: [coverImage("show.jpg")],
				name: `Calendar Show ${crypto.randomUUID()}`,
				seasons: [
					{ seasonNumber: 0, episodes: [{ episodeNumber: 1, publishDate: "2026-09-20" }] },
					{
						seasonNumber: 1,
						episodes: [
							{ episodeNumber: 1, publishDate: "2026-09-05" },
							{ episodeNumber: 2, publishDate: "2026-09-12", images: [coverImage("episode.jpg")] },
							{ episodeNumber: 3, publishDate: "2026-10-02" },
						],
					},
				],
			});
			yield* seedLibraryShowEpisodes(client, {
				inLibrary: false,
				name: `Calendar Outside Show ${crypto.randomUUID()}`,
				seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1, publishDate: "2026-09-08" }] }],
			});
			const episode = (seasonNumber: number, episodeNumber: number) => {
				const found = episodes.find(
					(candidate) =>
						candidate.seasonNumber === seasonNumber && candidate.episodeNumber === episodeNumber,
				);
				if (found === undefined) {
					throw new Error(`Missing S${seasonNumber}E${episodeNumber}`);
				}
				return found.id;
			};
			yield* createEventFixture(client, {
				entityId: episode(1, 1),
				eventSchemaSlug: complete,
				occurredAt: "2026-09-06T00:00:00.000Z",
				properties: { completionMode: "unknown" },
			});

			expect(summary(yield* occurrences(client, "show-episodes"))).toEqual([
				{
					done: true,
					subject: show.id,
					caption: "S1 · E1",
					art: remoteAsset("show.jpg"),
					startAt: "2026-09-05T00:00:00.000Z",
				},
				{
					done: false,
					subject: show.id,
					caption: "S1 · E2",
					art: remoteAsset("episode.jpg"),
					startAt: "2026-09-12T00:00:00.000Z",
				},
				{
					done: false,
					subject: show.id,
					caption: "S0 · E1",
					art: remoteAsset("show.jpg"),
					startAt: "2026-09-20T00:00:00.000Z",
				},
			]);
		}),
	);

	it.live("lists in-library podcast episodes numbered without seasons", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const complete = yield* eventSlug(client, "podcast-episode", "complete");
			const { podcast, episodes } = yield* seedLibraryPodcastEpisodes(client, {
				images: [coverImage("podcast.jpg")],
				name: `Calendar Podcast ${crypto.randomUUID()}`,
				episodes: [
					{ episodeNumber: 7, publishDate: "2026-09-03", images: [coverImage("pod-ep.jpg")] },
					{ episodeNumber: 8, publishDate: "2026-09-10" },
				],
			});
			yield* createEventFixture(client, {
				eventSchemaSlug: complete,
				occurredAt: "2026-09-04T00:00:00.000Z",
				properties: { completionMode: "unknown" },
				entityId: requirePresent(episodes[0], "Expected a seeded episode").id,
			});

			expect(summary(yield* occurrences(client, "podcast-episodes"))).toEqual([
				{
					done: true,
					subject: podcast.id,
					caption: "Episode 7",
					art: remoteAsset("pod-ep.jpg"),
					startAt: "2026-09-03T00:00:00.000Z",
				},
				{
					done: false,
					subject: podcast.id,
					caption: "Episode 8",
					art: remoteAsset("podcast.jpg"),
					startAt: "2026-09-10T00:00:00.000Z",
				},
			]);
		}),
	);

	it.live("lists anime airings without the release-day entry and tracks watched episodes", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findMediaEntitySchema(client, "anime");
			const progress = yield* eventSlug(client, "anime", "progress");
			const complete = yield* eventSlug(client, "anime", "complete");
			const anime = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				entitySchemaSlug: schema.id,
				name: `Calendar Anime ${crypto.randomUUID()}`,
				externalId: `calendar-anime-${crypto.randomUUID()}`,
				properties: {
					publishDate: "2026-09-12",
					images: [coverImage("anime.jpg")],
					airingSchedule: [
						{ episode: 1, airingAt: "2026-09-12T00:00:00.000Z" },
						{ episode: 2, airingAt: "2026-09-13T14:30:00.000Z" },
						{ episode: 3, airingAt: "2026-09-20T14:30:00.000Z" },
					],
				},
			});
			yield* insertLibraryMembership(client, { mediaEntityId: anime.id });
			const airings = () =>
				occurrences(client, "anime-airings").pipe(
					Effect.map((items) =>
						items.map(({ art, done, caption, startAt }) => ({ art, done, caption, startAt })),
					),
				);
			expect(yield* airings()).toEqual(expectedAirings(false, false));

			yield* createEventFixture(client, {
				entityId: anime.id,
				eventSchemaSlug: progress,
				occurredAt: "2026-09-14T00:00:00.000Z",
				properties: { animeEpisode: 2, progressPercent: 10 },
			});
			expect(yield* airings()).toEqual(expectedAirings(true, false));

			yield* createEventFixture(client, {
				entityId: anime.id,
				eventSchemaSlug: progress,
				occurredAt: "2026-09-15T00:00:00.000Z",
				properties: { animeEpisode: 1, progressPercent: 10 },
			});
			expect(yield* airings()).toEqual(expectedAirings(false, false));

			yield* createEventFixture(client, {
				entityId: anime.id,
				eventSchemaSlug: complete,
				occurredAt: "2026-09-16T00:00:00.000Z",
				properties: { completionMode: "unknown" },
			});
			expect(yield* airings()).toEqual(expectedAirings(true, true));
		}),
	);

	it.live("lists in-library releases with their schema label and completion", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const [movieSchema, bookSchema, animeSchema] = yield* Effect.all([
				findMediaEntitySchema(client, "movie"),
				findMediaEntitySchema(client, "book"),
				findMediaEntitySchema(client, "anime"),
			]);
			const complete = yield* eventSlug(client, "movie", "complete");
			const [movie, book, anime] = yield* Effect.all([
				seedRelease(movieSchema.schema.id, "movie", {
					publishDate: "2026-09-15",
					images: [coverImage("movie.jpg")],
				}),
				seedRelease(bookSchema.schema.id, "book", { publishDate: "2026-09-16" }),
				seedRelease(animeSchema.schema.id, "anime", {
					publishDate: "2026-09-12",
					airingSchedule: [{ episode: 1, airingAt: "2026-09-12T00:00:00.000Z" }],
				}),
			]);
			yield* Effect.all([
				insertLibraryMembership(client, { mediaEntityId: movie.id }),
				insertLibraryMembership(client, { mediaEntityId: anime.id }),
			]);
			const releases = () =>
				occurrences(client, "releases").pipe(
					Effect.map((items) =>
						items.map(({ art, done, caption, startAt, subject }) => ({
							art,
							done,
							caption,
							startAt,
							subject: subject.id,
						})),
					),
				);
			const animeRow = {
				art: null,
				done: false,
				subject: anime.id,
				caption: "Anime release",
				startAt: "2026-09-12T00:00:00.000Z",
			};
			const movieRow = (done: boolean) => ({
				done,
				subject: movie.id,
				caption: "Movie release",
				art: remoteAsset("movie.jpg"),
				startAt: "2026-09-15T00:00:00.000Z",
			});

			expect(yield* releases()).toEqual([animeRow, movieRow(false)]);

			yield* createEventFixture(client, {
				entityId: movie.id,
				eventSchemaSlug: complete,
				occurredAt: "2026-09-17T00:00:00.000Z",
				properties: { completionMode: "unknown" },
			});
			expect(yield* releases()).toEqual([animeRow, movieRow(true)]);
			expect((yield* releases()).map(({ subject }) => subject)).not.toContain(book.id);
		}),
	);
});
