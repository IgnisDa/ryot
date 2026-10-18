import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	episodicEarlierUnwatchedRecipe,
	mediaActivityLogContextRecipe,
	showSeasonEpisodeChoicesRecipe,
} from "@ryot-app/media-plugin/shared/activity-log-recipes";
import { DateTime, Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	listEventsForEntity,
	pollUntil,
	waitForEventWithSchema,
} from "~/fixtures/kernel";
import { listPluginUserSettings } from "~/fixtures/kernel/plugin-user-settings";
import {
	createBuiltinMediaLifecycleFixture,
	logMediaActivity,
	logMediaActivityUnchecked,
	mediaReferenceForEntity,
	seedPodcast,
	seedShow,
} from "~/fixtures/plugins/media";
import { assertPresent, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

const isoOf = (value: string) => DateTime.formatIso(DateTime.makeUnsafe(value));

const readContext = (client: Parameters<typeof mediaReferenceForEntity>[0], entityId: string) =>
	Effect.gen(function* () {
		const reference = yield* mediaReferenceForEntity(client, entityId);
		const context = yield* executeRyotQLRecipe(
			client,
			mediaActivityLogContextRecipe({ entityId, reference }),
		);
		assertPresent(context, "Expected an activity log context");
		return context;
	});

const readEvents = (
	client: Parameters<typeof mediaReferenceForEntity>[0],
	entityId: string,
	eventSchemaSlug?: string,
) =>
	listEventsForEntity(
		client,
		entityId,
		undefined,
		100,
		eventSchemaSlug === undefined ? {} : { eventSchemaSlug },
	);

const codes = (items: readonly { episodeNumber: number; seasonNumber: null | number }[]) =>
	items.map((item) => `S${item.seasonNumber}E${item.episodeNumber}`);

describe("Media activity log operation", () => {
	it.live("completes a movie just now, on picked dates, and with an unknown date", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const now = yield* createBuiltinMediaLifecycleFixture(client, { entitySchemaSlug: "movie" });
			const picked = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const unknown = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});

			const submittedAt = nowIso();
			expect(
				yield* logMediaActivity(client, {
					submittedAt,
					submissionId: crypto.randomUUID(),
					entry: {
						timeSpent: 95,
						kind: "complete",
						consumedOn: "Cinema",
						when: { kind: "now" },
						entityId: now.entityId,
					},
				}),
			).toEqual({ count: 1, status: "saved" });
			const nowEvents = yield* readEvents(client, now.entityId, "complete");
			expect(nowEvents).toHaveLength(1);
			const [nowEvent] = nowEvents;
			assertPresent(nowEvent, "Expected the just-now completion");
			expect(nowEvent.eventSchemaSlug).toBe("complete");
			expect(isoOf(nowEvent.occurredAt)).toBe(submittedAt);
			expect(nowEvent.properties).toEqual({ timeSpent: 95, consumedOn: "Cinema" });

			yield* logMediaActivity(client, {
				submittedAt,
				submissionId: crypto.randomUUID(),
				entry: {
					kind: "complete",
					entityId: picked.entityId,
					when: {
						kind: "date",
						startedOn: "2026-01-08T12:00:00.000Z",
						finishedOn: "2026-01-10T12:00:00.000Z",
					},
				},
			});
			const [pickedEvent] = yield* readEvents(client, picked.entityId, "complete");
			assertPresent(pickedEvent, "Expected the picked-date completion");
			expect(isoOf(pickedEvent.occurredAt)).toBe("2026-01-10T12:00:00.000Z");
			expect(pickedEvent.properties).toMatchObject({ startedOn: "2026-01-08T12:00:00.000Z" });
			expect(pickedEvent.properties).not.toHaveProperty("dateUnknown");

			yield* logMediaActivity(client, {
				submittedAt,
				submissionId: crypto.randomUUID(),
				entry: { kind: "complete", when: { kind: "unknown" }, entityId: unknown.entityId },
			});
			const [unknownEvent] = yield* readEvents(client, unknown.entityId, "complete");
			assertPresent(unknownEvent, "Expected the unknown-date completion");
			expect(isoOf(unknownEvent.occurredAt)).toBe(submittedAt);
			expect(unknownEvent.properties).toMatchObject({ dateUnknown: true });
		}),
	);

	it.live("adds a new source to the user's list for the media type once", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const movie = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const book = yield* createBuiltinMediaLifecycleFixture(client, { entitySchemaSlug: "book" });
			const mediaSettings = () =>
				Effect.map(
					listPluginUserSettings(client),
					(installations) =>
						requirePresent(
							installations.find(({ name }) => name === "Media"),
							"Media settings not found",
						).settings,
				);
			expect(yield* mediaSettings()).toEqual({});

			const log = (entityId: string, consumedOn: string) =>
				logMediaActivity(client, {
					submittedAt: nowIso(),
					submissionId: crypto.randomUUID(),
					entry: { entityId, consumedOn, kind: "complete", when: { kind: "now" } },
				});
			expect(yield* log(movie.entityId, "Criterion Channel")).toEqual({
				count: 1,
				status: "saved",
			});
			const afterFirst = yield* mediaSettings();
			expect(Object.keys(afterFirst)).toEqual(["consumedOnMovie"]);
			expect(afterFirst.consumedOnMovie).toEqual([
				"Netflix",
				"Amazon Prime",
				"Disney+",
				"HBO Max",
				"Apple TV",
				"Peacock",
				"Hulu",
				"Crunchyroll",
				"Cinema",
				"Criterion Channel",
			]);

			yield* log(movie.entityId, "criterion channel");
			yield* log(movie.entityId, "NETFLIX");
			expect(yield* mediaSettings()).toEqual(afterFirst);

			yield* log(book.entityId, "Bookshop");
			expect((yield* mediaSettings()).consumedOnBook).toEqual([
				"Paperback",
				"Hardcover",
				"Kindle",
				"Kobo",
				"Library",
				"Bookshop",
			]);
		}),
	);

	it.live("accepts a finished date equal to submittedAt", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId } = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const submittedAt = nowIso();

			yield* logMediaActivity(client, {
				submittedAt,
				submissionId: crypto.randomUUID(),
				entry: {
					entityId,
					kind: "complete",
					when: { kind: "date", startedOn: submittedAt, finishedOn: submittedAt },
				},
			});

			const events = yield* readEvents(client, entityId, "complete");
			expect(events.map((event) => isoOf(event.occurredAt))).toEqual([submittedAt]);
		}),
	);

	it.live("suggests this entity's consumedOn values before the schema's recent ones", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const first = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const second = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const submittedAt = nowIso();
			const complete = (entityId: string, consumedOn: string, finishedOn: string) =>
				logMediaActivity(client, {
					submittedAt,
					submissionId: crypto.randomUUID(),
					entry: { entityId, consumedOn, kind: "complete", when: { finishedOn, kind: "date" } },
				});

			yield* complete(first.entityId, "Plex", "2026-01-01T12:00:00.000Z");
			yield* complete(first.entityId, "Kodi", "2026-02-01T12:00:00.000Z");
			yield* complete(second.entityId, "Jellyfin", "2026-03-01T12:00:00.000Z");

			expect((yield* readContext(client, first.entityId)).consumedOn).toEqual([
				"Kodi",
				"Plex",
				"Jellyfin",
			]);
			expect((yield* readContext(client, second.entityId)).consumedOn).toEqual([
				"Jellyfin",
				"Kodi",
				"Plex",
			]);
		}),
	);

	it.live("logs book progress as just started and as a percent", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId } = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "book",
				properties: { pages: 300 },
			});
			const submittedAt = nowIso();

			yield* logMediaActivity(client, {
				submittedAt,
				submissionId: crypto.randomUUID(),
				entry: { entityId, kind: "progress" },
			});
			yield* logMediaActivity(client, {
				submittedAt,
				submissionId: crypto.randomUUID(),
				entry: { entityId, kind: "progress", progressPercent: 40, consumedOn: "Kindle" },
			});

			const events = yield* readEvents(client, entityId, "progress");
			expect(events).toHaveLength(2);
			expect(events.map((event) => event.properties)).toContainEqual({});
			expect(events.map((event) => event.properties)).toContainEqual({
				progressPercent: 40,
				consumedOn: "Kindle",
			});
			const context = yield* readContext(client, entityId);
			expect(context.progressPercent).toBe(40);
			expect(context.state).toBe("in_progress");
		}),
	);

	it.live("logs anime position and completes it automatically at the final episode", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId } = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "anime",
				properties: { episodes: 3 },
			});
			const progress = (position: number) =>
				logMediaActivity(client, {
					submittedAt: nowIso(),
					submissionId: crypto.randomUUID(),
					entry: { entityId, position, kind: "progress" },
				});

			yield* progress(1);
			const afterFirst = yield* readContext(client, entityId);
			expect(afterFirst.position).toBe(1);
			expect(afterFirst.state).toBe("in_progress");
			expect(yield* readEvents(client, entityId, "complete")).toHaveLength(0);

			yield* progress(3);
			yield* waitForEventWithSchema(client, entityId, "complete");
			const progressEvents = yield* readEvents(client, entityId, "progress");
			expect(progressEvents).toHaveLength(2);
			expect(progressEvents.map((event) => event.properties)).toContainEqual({ animeEpisode: 1 });
			expect(progressEvents.map((event) => event.properties)).toContainEqual({ animeEpisode: 3 });
			expect(yield* readEvents(client, entityId, "complete")).toHaveLength(1);
			expect((yield* readContext(client, entityId)).state).toBe("complete");
		}),
	);

	it.live("writes backlog, on hold and dropped events without properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const movie = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const {
				show: { id: showId },
			} = yield* seedShow(client, {
				seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }] }],
			});

			for (const status of ["backlog", "on_hold", "dropped"] as const) {
				for (const entityId of [movie.entityId, showId]) {
					expect(
						yield* logMediaActivity(client, {
							submittedAt: nowIso(),
							submissionId: crypto.randomUUID(),
							entry: { status, entityId, kind: "status" },
						}),
					).toEqual({ count: 1, status: "saved" });
					const events = yield* readEvents(client, entityId, status);
					expect(events).toHaveLength(1);
					expect(events[0]?.properties).toEqual({});
				}
			}
		}),
	);

	it.live("reads next-up, seasons and earlier unwatched episodes across seasons", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const {
				seasons,
				episodeId,
				show: { id: showId },
			} = yield* seedShow(client, {
				seasons: [
					{ seasonNumber: 0, episodes: [{ episodeNumber: 1 }] },
					{
						seasonNumber: 1,
						episodes: [
							{ episodeNumber: 1 },
							{ episodeNumber: 2 },
							{ episodeNumber: 3 },
							{ aired: false, episodeNumber: 4 },
						],
					},
					{ seasonNumber: 2, episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }] },
				],
			});
			const reference = yield* mediaReferenceForEntity(client, showId);
			const log = (episodeEntityIds: readonly string[]) =>
				logMediaActivity(client, {
					submittedAt: nowIso(),
					submissionId: crypto.randomUUID(),
					entry: {
						episodeEntityIds,
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: showId,
					},
				});
			const earlier = (anchor: string) =>
				executeRyotQLRecipe(
					client,
					episodicEarlierUnwatchedRecipe({
						reference,
						limit: 100,
						kind: "show",
						parentEntityId: showId,
						episodeEntityId: anchor,
					}),
				);

			const initial = yield* readContext(client, showId);
			expect(initial.nextUp).toBeNull();
			expect(initial.seasons.map((season) => season.seasonNumber)).toEqual([0, 1, 2]);
			expect(initial.seasons.map((season) => season.id)).toEqual(seasons.map(({ id }) => id));

			yield* log([episodeId(1, 2)]);
			expect((yield* readContext(client, showId)).nextUp?.id).toBe(episodeId(1, 3));
			const beforeSecondSeason = yield* earlier(episodeId(2, 1));
			expect(codes(beforeSecondSeason.items)).toEqual(["S1E1", "S1E3"]);
			expect(beforeSecondSeason.hasMore).toBe(false);
			expect(codes((yield* earlier(episodeId(1, 3))).items)).toEqual(["S1E1"]);
			expect(codes((yield* earlier(episodeId(1, 1))).items)).toEqual([]);
			expect(codes((yield* earlier(episodeId(0, 1))).items)).toEqual([]);

			const choices = yield* executeRyotQLRecipe(
				client,
				showSeasonEpisodeChoicesRecipe({
					reference,
					limit: 100,
					seasonNumber: 1,
					showEntityId: showId,
				}),
			);
			expect(choices.items.map((choice) => [choice.episodeNumber, choice.state])).toEqual([
				[1, "untracked"],
				[2, "complete"],
				[3, "untracked"],
				[4, "untracked"],
			]);
			const specials = yield* executeRyotQLRecipe(
				client,
				showSeasonEpisodeChoicesRecipe({
					reference,
					limit: 100,
					seasonNumber: 0,
					showEntityId: showId,
				}),
			);
			expect(specials.items.map((choice) => choice.id)).toEqual([episodeId(0, 1)]);

			const backfill = [episodeId(1, 1), episodeId(1, 3), episodeId(2, 1)];
			expect(yield* log(backfill)).toEqual({ count: 3, status: "saved" });
			for (const id of backfill) {
				const events = yield* readEvents(client, id, "complete");
				expect(events).toHaveLength(1);
				expect(events[0]?.sessionEntityId).toBe(showId);
			}
			expect((yield* readContext(client, showId)).nextUp?.id).toBe(episodeId(2, 2));
			expect((yield* earlier(episodeId(2, 2))).items).toEqual([]);
		}),
	);

	it.live("moves a show with every aired regular episode logged to caught up", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const {
				episodeId,
				show: { id: showId },
			} = yield* seedShow(client, {
				seasons: [
					{ seasonNumber: 0, episodes: [{ episodeNumber: 1 }] },
					{
						seasonNumber: 1,
						episodes: [
							{ episodeNumber: 1 },
							{ episodeNumber: 2 },
							{ aired: false, episodeNumber: 3 },
						],
					},
				],
			});

			yield* logMediaActivity(client, {
				submittedAt: nowIso(),
				submissionId: crypto.randomUUID(),
				entry: {
					kind: "episodes",
					parentEntityId: showId,
					when: { kind: "unknown" },
					episodeEntityIds: [episodeId(1, 1), episodeId(1, 2)],
				},
			});

			const context = yield* pollUntil(
				"show caught up",
				readContext(client, showId).pipe(
					Effect.map((value) => (value.state === "caught_up" ? value : null)),
				),
			);
			expect(context.state).toBe("caught_up");
			expect(yield* readEvents(client, showId, "complete")).toHaveLength(0);
		}),
	);

	it.live("completes an ended show once every aired episode is logged", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const {
				episodeId,
				show: { id: showId },
			} = yield* seedShow(client, {
				properties: { productionStatus: "Ended" },
				seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }] }],
			});

			yield* logMediaActivity(client, {
				submittedAt: nowIso(),
				submissionId: crypto.randomUUID(),
				entry: {
					kind: "episodes",
					consumedOn: "Plex",
					parentEntityId: showId,
					when: { kind: "unknown" },
					episodeEntityIds: [episodeId(1, 1), episodeId(1, 2)],
				},
			});

			const parentCompletion = yield* waitForEventWithSchema(client, showId, "complete");
			expect(parentCompletion.properties).toMatchObject({ dateUnknown: true, consumedOn: "Plex" });
			expect((yield* readContext(client, showId)).state).toBe("complete");
		}),
	);

	it.live("logs a podcast episode and orders earlier unwatched by episode number", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const {
				episodes,
				podcast: { id: podcastId },
			} = yield* seedPodcast(client, {
				episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }, { episodeNumber: 3 }],
			});
			const [first, second, third] = episodes.map(({ id }) => id);
			assertPresent(first, "Expected podcast episode 1");
			assertPresent(second, "Expected podcast episode 2");
			assertPresent(third, "Expected podcast episode 3");
			const reference = yield* mediaReferenceForEntity(client, podcastId);
			const earlier = (anchor: string) =>
				executeRyotQLRecipe(
					client,
					episodicEarlierUnwatchedRecipe({
						reference,
						limit: 100,
						kind: "podcast",
						episodeEntityId: anchor,
						parentEntityId: podcastId,
					}),
				);

			expect((yield* readContext(client, podcastId)).nextUp?.id).toBe(third);
			expect((yield* earlier(third)).items.map((item) => item.id)).toEqual([first, second]);

			yield* logMediaActivity(client, {
				submittedAt: nowIso(),
				submissionId: crypto.randomUUID(),
				entry: {
					kind: "episodes",
					when: { kind: "now" },
					parentEntityId: podcastId,
					episodeEntityIds: [first],
					consumedOn: "Pocket Casts",
				},
			});

			const [event] = yield* readEvents(client, first, "complete");
			assertPresent(event, "Expected the podcast episode completion");
			expect(event.sessionEntityId).toBe(podcastId);
			expect(event.properties).toEqual({ consumedOn: "Pocket Casts" });
			expect((yield* earlier(third)).items.map((item) => item.id)).toEqual([second]);
			expect((yield* readContext(client, podcastId)).nextUp?.id).toBe(third);
		}),
	);

	it.live("rejects invalid entries without writing any event", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const movie = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const anime = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "anime",
				properties: { episodes: 3 },
			});
			const show = yield* seedShow(client, {
				seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }] }],
			});
			const otherShow = yield* seedShow(client, {
				seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }] }],
			});
			const submittedAt = "2026-03-10T09:00:00.000Z";
			const attempt = (entry: JsonValue) => {
				const submissionId = crypto.randomUUID();
				return Effect.flip(
					logMediaActivityUnchecked(client, submissionId, { entry, submittedAt, submissionId }),
				);
			};
			const invalid = [
				attempt({
					kind: "complete",
					entityId: movie.entityId,
					when: { kind: "date", finishedOn: "2026-03-10T09:00:01.000Z" },
				}),
				attempt({
					kind: "complete",
					entityId: movie.entityId,
					when: {
						kind: "date",
						startedOn: "2026-03-09T12:00:00.000Z",
						finishedOn: "2026-03-08T12:00:00.000Z",
					},
				}),
			];
			const rejected = [
				attempt({ kind: "progress", progressPercent: 10, entityId: show.show.id }),
				attempt({ kind: "complete", when: { kind: "now" }, entityId: show.show.id }),
				attempt({
					kind: "episodes",
					when: { kind: "now" },
					parentEntityId: show.show.id,
					episodeEntityIds: [show.episodeId(1, 1), otherShow.episodeId(1, 1)],
				}),
				attempt({
					kind: "episodes",
					when: { kind: "now" },
					parentEntityId: show.show.id,
					episodeEntityIds: [otherShow.episodeId(1, 1)],
				}),
				attempt({ position: 2, kind: "progress", entityId: movie.entityId }),
				attempt({ kind: "progress", progressPercent: 50, entityId: anime.entityId }),
				attempt({ kind: "progress", entityId: anime.entityId }),
				attempt({ kind: "status", status: "dropped", entityId: crypto.randomUUID() }),
			];

			for (const failure of yield* Effect.all(invalid)) {
				assertTaggedError(failure, "PluginInvocationError");
			}
			for (const failure of yield* Effect.all(rejected)) {
				assertTaggedError(failure, "PluginOperationRejected");
				expect(failure.message).not.toBe("");
			}
			for (const entityId of [
				movie.entityId,
				anime.entityId,
				show.show.id,
				show.episodeId(1, 1),
				otherShow.episodeId(1, 1),
			]) {
				const slugs = (yield* readEvents(client, entityId)).map((event) => event.eventSchemaSlug);
				expect(slugs.filter((slug) => slug !== "add-to-media-library")).toEqual([]);
			}
		}),
	);

	it.live("writes no duplicates when the same submission is retried", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const movie = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const show = yield* seedShow(client, {
				seasons: [
					{
						seasonNumber: 1,
						episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }, { episodeNumber: 3 }],
					},
				],
			});
			const submittedAt = nowIso();
			const movieInput = {
				submittedAt,
				submissionId: crypto.randomUUID(),
				entry: { kind: "complete", when: { kind: "now" }, entityId: movie.entityId },
			} as const;
			const episodeIds = [show.episodeId(1, 3), show.episodeId(1, 1), show.episodeId(1, 2)];
			const showInput = {
				submittedAt,
				submissionId: crypto.randomUUID(),
				entry: {
					kind: "episodes",
					when: { kind: "now" },
					parentEntityId: show.show.id,
					episodeEntityIds: episodeIds,
				},
			} as const;

			const firstMovie = yield* logMediaActivity(client, movieInput);
			const retriedMovie = yield* logMediaActivity(client, movieInput);
			const firstShow = yield* logMediaActivity(client, showInput);
			const retriedShow = yield* Effect.all(
				[logMediaActivity(client, showInput), logMediaActivity(client, showInput)],
				{ concurrency: "unbounded" },
			);

			expect(firstMovie).toEqual({ count: 1, status: "saved" });
			expect(retriedMovie).toEqual(firstMovie);
			expect(firstShow).toEqual({ count: 3, status: "saved" });
			expect(retriedShow).toEqual([firstShow, firstShow]);
			expect(yield* readEvents(client, movie.entityId, "complete")).toHaveLength(1);
			for (const id of episodeIds) {
				expect(yield* readEvents(client, id, "complete")).toHaveLength(1);
			}
		}),
	);
});
