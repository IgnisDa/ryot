import { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	episodicEarlierUnwatchedRecipe,
	mediaActivityLogContextRecipe,
	showSeasonChoicesRecipe,
	showSeasonEpisodeChoicesRecipe,
} from "@ryot-app/media-plugin/shared/activity-log-recipes";
import type { MediaPosition } from "@ryot-app/media-plugin/shared/consumption";
import {
	type MediaActivityPatch,
	MediaEventSnapshot,
} from "@ryot-app/media-plugin/shared/media-activity-operations";
import { randomUuid } from "@ryot-app/testing/random";
import { DateTime, Effect, Schema } from "effect";

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
	updateMediaActivity,
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

const retargetEpisode = (
	client: Parameters<typeof mediaReferenceForEntity>[0],
	event: {
		readonly id: string;
		readonly occurredAt: string;
		readonly properties: Record<string, unknown>;
		readonly sessionEntityId?: string | undefined;
	},
	from: string,
	episodeEntityId: string,
) =>
	Effect.gen(function* () {
		return yield* updateMediaActivity(client, {
			eventId: event.id,
			submittedAt: nowIso(),
			patch: { episodeEntityId },
			submissionId: yield* randomUuid,
			expected: yield* Schema.decodeUnknownEffect(MediaEventSnapshot)({
				entityId: from,
				absentProperties: [],
				properties: event.properties,
				occurredAt: isoOf(event.occurredAt),
				sessionEntityId: event.sessionEntityId ?? null,
			}),
		});
	});
const logEpisodeCompletions = (
	client: Parameters<typeof mediaReferenceForEntity>[0],
	parentEntityId: string,
	episodeEntityIds: readonly string[],
) =>
	Effect.gen(function* () {
		yield* logMediaActivity(client, {
			submittedAt: nowIso(),
			submissionId: yield* randomUuid,
			entry: { parentEntityId, episodeEntityIds, kind: "episodes", when: { kind: "unknown" } },
		});
	});
const episodeCompletion = (
	client: Parameters<typeof mediaReferenceForEntity>[0],
	episodeEntityId: string,
) =>
	Effect.gen(function* () {
		const [event] = yield* readEvents(client, episodeEntityId, "complete");
		assertPresent(event, "Expected the episode completion");
		return event;
	});

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
					submissionId: yield* randomUuid,
					entry: {
						timeSpent: 95,
						kind: "complete",
						when: { kind: "now" },
						consumedOn: ["Cinema"],
						entityId: now.entityId,
					},
				}),
			).toEqual({ count: 1, status: "saved" });
			const nowEvents = yield* readEvents(client, now.entityId, "complete");
			expect(nowEvents).toHaveLength(1);
			const [nowEvent] = nowEvents;
			assertPresent(nowEvent, "Expected the just-now completion");
			expect(nowEvent.eventSchemaSlug).toBe(EventSchemaSlug.make("complete"));
			expect(isoOf(nowEvent.occurredAt)).toBe(submittedAt);
			expect(nowEvent.properties).toEqual({
				timeSpent: 95,
				consumedOn: ["Cinema"],
				consumptionBasis: { unit: "minutes", property: "runtime" },
			});

			yield* logMediaActivity(client, {
				submittedAt,
				submissionId: yield* randomUuid,
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
				submissionId: yield* randomUuid,
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

			const log = (entityId: string, consumedOn: readonly string[]) =>
				logMediaActivity(client, {
					submittedAt: nowIso(),
					submissionId: crypto.randomUUID(),
					entry: { entityId, consumedOn, kind: "complete", when: { kind: "now" } },
				});
			expect(yield* log(movie.entityId, ["Criterion Channel"])).toEqual({
				count: 1,
				status: "saved",
			});
			const afterFirst = yield* mediaSettings();
			expect(Object.keys(afterFirst)).toEqual(["consumedOnMovie"]);
			const movieSources = [
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
			];
			expect(afterFirst.consumedOnMovie).toEqual(movieSources);

			yield* log(movie.entityId, ["criterion channel"]);
			yield* log(movie.entityId, ["NETFLIX"]);
			expect(yield* mediaSettings()).toEqual(afterFirst);

			yield* log(movie.entityId, ["mubi", "Criterion Channel", "NETFLIX"]);
			expect((yield* mediaSettings()).consumedOnMovie).toEqual([...movieSources, "mubi"]);

			yield* log(book.entityId, ["Bookshop"]);
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
				submissionId: yield* randomUuid,
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
			const complete = (entityId: string, consumedOn: readonly string[], finishedOn: string) =>
				logMediaActivity(client, {
					submittedAt,
					submissionId: crypto.randomUUID(),
					entry: { entityId, consumedOn, kind: "complete", when: { finishedOn, kind: "date" } },
				});

			yield* complete(first.entityId, ["Plex", "Emby"], "2026-01-01T12:00:00.000Z");
			yield* complete(first.entityId, ["Emby"], "2026-01-15T12:00:00.000Z");
			yield* complete(first.entityId, ["Kodi"], "2026-02-01T12:00:00.000Z");
			yield* complete(second.entityId, ["Jellyfin"], "2026-03-01T12:00:00.000Z");

			expect((yield* readContext(client, first.entityId)).consumedOn).toEqual([
				"Kodi",
				"Emby",
				"Plex",
				"Jellyfin",
			]);
			expect((yield* readContext(client, second.entityId)).consumedOn).toEqual([
				"Jellyfin",
				"Kodi",
				"Emby",
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
				submissionId: yield* randomUuid,
				entry: { entityId, kind: "progress" },
			});
			yield* logMediaActivity(client, {
				submittedAt,
				submissionId: yield* randomUuid,
				entry: { entityId, kind: "progress", progressPercent: 40, consumedOn: ["Kindle"] },
			});

			const events = yield* readEvents(client, entityId, "progress");
			expect(events).toHaveLength(2);
			expect(events.map((event) => event.properties)).toContainEqual({
				consumptionBasis: { total: 300, unit: "pages", property: "pages" },
			});
			expect(events.map((event) => event.properties)).toContainEqual({
				progressPercent: 40,
				consumedOn: ["Kindle"],
				consumptionBasis: { total: 300, unit: "pages", property: "pages" },
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
					entry: { entityId, kind: "progress", position: { position, unit: "episodes" } },
				});

			yield* progress(1);
			const afterFirst = yield* readContext(client, entityId);
			expect(afterFirst.position).toEqual({ position: 1, unit: "episodes" });
			expect(afterFirst.state).toBe("in_progress");
			expect(yield* readEvents(client, entityId, "complete")).toHaveLength(0);

			yield* progress(3);
			yield* waitForEventWithSchema(client, entityId, "complete");
			const progressEvents = yield* readEvents(client, entityId, "progress");
			expect(progressEvents).toHaveLength(2);
			expect(progressEvents.map((event) => event.properties)).toContainEqual({
				position: { position: 1, unit: "episodes" },
				consumptionBasis: { total: 3, unit: "episodes", property: "episodes" },
			});
			expect(progressEvents.map((event) => event.properties)).toContainEqual({
				position: { position: 3, unit: "episodes" },
				consumptionBasis: { total: 3, unit: "episodes", property: "episodes" },
			});
			expect(yield* readEvents(client, entityId, "complete")).toHaveLength(1);
			expect((yield* readContext(client, entityId)).state).toBe("complete");
		}),
	);

	it.live(
		"logs a fractional manga chapter, then a volume run that completes at the volume total",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { entityId } = yield* createBuiltinMediaLifecycleFixture(client, {
					entitySchemaSlug: "manga",
					properties: { volumes: 3, chapters: 20 },
				});
				const progress = (position: MediaPosition) =>
					logMediaActivity(client, {
						submittedAt: nowIso(),
						submissionId: crypto.randomUUID(),
						entry: { entityId, position, kind: "progress" },
					});

				yield* progress({ position: 10.5, unit: "chapters" });
				const context = yield* readContext(client, entityId);
				expect(context.position).toEqual({ position: 10.5, unit: "chapters" });
				expect(context.progressPercent).toBe(52.5);

				yield* progress({ position: 2, unit: "volumes" });
				const volumes = yield* readContext(client, entityId);
				expect(volumes).toMatchObject({
					volumes: 3,
					state: "in_progress",
					progressPercent: 66.67,
					position: { position: 2, unit: "volumes" },
				});
				expect(yield* readEvents(client, entityId, "complete")).toHaveLength(0);

				yield* progress({ position: 3, unit: "volumes" });
				yield* waitForEventWithSchema(client, entityId, "complete");
				const [completion] = yield* readEvents(client, entityId, "complete");
				assertPresent(completion, "Expected the volume-total completion");
				expect(completion.properties).toMatchObject({
					consumptionBasis: { total: 3, unit: "volumes", property: "volumes" },
				});
				expect(
					(yield* readEvents(client, entityId, "progress")).map((event) => event.properties),
				).toContainEqual({
					position: { position: 3, unit: "volumes" },
					consumptionBasis: { total: 3, unit: "volumes", property: "volumes" },
				});
				expect((yield* readContext(client, entityId)).state).toBe("complete");
			}),
	);

	it.live("keeps a progress start date through logging and edits", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId } = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "book",
			});
			yield* logMediaActivity(client, {
				submittedAt: nowIso(),
				submissionId: yield* randomUuid,
				entry: {
					entityId,
					kind: "progress",
					progressPercent: 40,
					when: {
						kind: "date",
						calendarDate: "2026-01-10",
						startedOn: "2026-01-08T00:00:00.000Z",
						finishedOn: "2026-01-10T00:00:00.000Z",
					},
				},
			});
			const [logged] = yield* readEvents(client, entityId, "progress");
			assertPresent(logged, "Expected the dated progress");
			expect(logged.properties).toMatchObject({
				calendarDate: "2026-01-10",
				startedOn: "2026-01-08T00:00:00.000Z",
			});

			const edit = (event: typeof logged, patch: MediaActivityPatch) =>
				Effect.gen(function* () {
					yield* updateMediaActivity(client, {
						patch,
						eventId: event.id,
						submittedAt: nowIso(),
						submissionId: yield* randomUuid,
						expected: yield* Schema.decodeUnknownEffect(MediaEventSnapshot)({
							entityId,
							absentProperties: [],
							sessionEntityId: null,
							properties: event.properties,
							occurredAt: isoOf(event.occurredAt),
						}),
					});
					const [updated] = yield* readEvents(client, entityId, "progress");
					assertPresent(updated, "Expected the edited progress");
					return updated;
				});
			const timed = yield* edit(logged, { timeSpent: 30 });
			expect(timed.properties).toMatchObject({
				timeSpent: 30,
				startedOn: "2026-01-08T00:00:00.000Z",
			});
			const exact = yield* edit(timed, {
				when: {
					kind: "date",
					startedOn: "2026-01-08T00:00:00.000Z",
					finishedOn: "2026-01-11T18:30:00.000Z",
				},
			});
			expect(isoOf(exact.occurredAt)).toBe("2026-01-11T18:30:00.000Z");
			expect(exact.properties).toMatchObject({ startedOn: "2026-01-08T00:00:00.000Z" });
			expect(exact.properties).not.toHaveProperty("calendarDate");
		}),
	);

	it.live("writes status events with frozen bases and no progress quantities", () =>
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

			const targets = [
				{ entityId: movie.entityId, basis: { unit: "minutes", property: "runtime" } },
				{ entityId: showId, basis: { unit: "episodes" } },
			];
			for (const status of ["backlog", "on_hold", "dropped"] as const) {
				for (const target of targets) {
					expect(
						yield* logMediaActivity(client, {
							submittedAt: nowIso(),
							submissionId: yield* randomUuid,
							entry: { status, kind: "status", entityId: target.entityId },
						}),
					).toEqual({ count: 1, status: "saved" });
					const events = yield* readEvents(client, target.entityId, status);
					expect(events).toHaveLength(1);
					expect(events[0]?.properties).toEqual(
						status === "backlog" ? {} : { consumptionBasis: target.basis },
					);
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
			expect(initial.seasons.map((season) => season.seasonNumber)).toEqual([1]);
			const seasonChoices = yield* executeRyotQLRecipe(
				client,
				showSeasonChoicesRecipe({ reference, limit: 100, entityId: showId }),
			);
			expect(seasonChoices.items.map((season) => season.seasonNumber)).toEqual([0, 1, 2]);
			expect(seasonChoices.items.map((season) => season.id)).toEqual(seasons.map(({ id }) => id));

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
				submissionId: yield* randomUuid,
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
				submissionId: yield* randomUuid,
				entry: {
					kind: "episodes",
					parentEntityId: showId,
					when: { kind: "unknown" },
					consumedOn: ["Plex", "Netflix"],
					episodeEntityIds: [episodeId(1, 1), episodeId(1, 2)],
				},
			});

			const parentCompletion = yield* waitForEventWithSchema(client, showId, "complete");
			expect(parentCompletion.properties).toMatchObject({
				dateUnknown: true,
				consumedOn: ["Plex", "Netflix"],
			});
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
				submissionId: yield* randomUuid,
				entry: {
					kind: "episodes",
					when: { kind: "now" },
					parentEntityId: podcastId,
					episodeEntityIds: [first],
					consumedOn: ["Pocket Casts"],
				},
			});

			const [event] = yield* readEvents(client, first, "complete");
			assertPresent(event, "Expected the podcast episode completion");
			expect(event.sessionEntityId).toBe(podcastId);
			expect(event.properties).toEqual({
				consumedOn: ["Pocket Casts"],
				consumptionBasis: { unit: "minutes", property: "runtime" },
			});
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
				attempt({
					kind: "progress",
					entityId: movie.entityId,
					position: { position: 2, unit: "episodes" },
				}),
				attempt({ kind: "progress", progressPercent: 50, entityId: anime.entityId }),
				attempt({ kind: "progress", entityId: anime.entityId }),
				attempt({ kind: "status", status: "dropped", entityId: yield* randomUuid }),
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
				submissionId: yield* randomUuid,
				entry: { kind: "complete", when: { kind: "now" }, entityId: movie.entityId },
			} as const;
			const episodeIds = [show.episodeId(1, 3), show.episodeId(1, 1), show.episodeId(1, 2)];
			const showInput = {
				submittedAt,
				submissionId: yield* randomUuid,
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

	describe("episode retargeting", () => {
		it.live("moves a show record between a special and a regular season and refolds the show", () =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const {
					episodeId,
					show: { id: showId },
				} = yield* seedShow(client, {
					seasons: [
						{ seasonNumber: 0, episodes: [{ episodeNumber: 1 }] },
						{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }] },
						{ seasonNumber: 2, episodes: [{ episodeNumber: 1 }] },
					],
				});
				const caughtUp = pollUntil(
					"show caught up",
					readContext(client, showId).pipe(
						Effect.map((value) => (value.state === "caught_up" ? value : null)),
					),
				);
				yield* logEpisodeCompletions(client, showId, [episodeId(1, 1), episodeId(2, 1)]);
				yield* caughtUp;

				yield* retargetEpisode(
					client,
					yield* episodeCompletion(client, episodeId(2, 1)),
					episodeId(2, 1),
					episodeId(0, 1),
				);
				const special = yield* episodeCompletion(client, episodeId(0, 1));
				expect(special.sessionEntityId).toBeUndefined();
				expect(yield* readEvents(client, episodeId(2, 1), "complete")).toHaveLength(0);
				yield* pollUntil(
					"show leaves caught up",
					readContext(client, showId).pipe(
						Effect.map((value) => (value.state === "caught_up" ? null : value)),
					),
				);

				yield* retargetEpisode(client, special, episodeId(0, 1), episodeId(2, 1));
				const moved = yield* episodeCompletion(client, episodeId(2, 1));
				expect(moved.id).toBe(special.id);
				expect(moved.sessionEntityId).toBe(showId);
				yield* caughtUp;
			}),
		);

		it.live("moves a podcast record to another episode of the same podcast", () =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const {
					episodes,
					podcast: { id: podcastId },
				} = yield* seedPodcast(client, { episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }] });
				const [first, second] = episodes.map(({ id }) => id);
				assertPresent(first, "Expected podcast episode 1");
				assertPresent(second, "Expected podcast episode 2");
				yield* logEpisodeCompletions(client, podcastId, [first]);
				const completion = yield* episodeCompletion(client, first);
				yield* client.call((c) =>
					c.events.create({
						payload: [
							{
								entityId: first,
								eventSchemaSlug: EventSchemaSlug.make("review"),
								properties: { rating: 80, consumptionEventId: completion.id },
							},
						],
					}),
				);
				yield* retargetEpisode(client, completion, first, second);
				expect((yield* episodeCompletion(client, second)).sessionEntityId).toBe(podcastId);
				expect(yield* readEvents(client, first, "complete")).toHaveLength(0);
				const [review] = yield* readEvents(client, first, "review");
				assertPresent(review, "Expected the review to remain");
				expect(review.properties).toEqual({ rating: 80 });
			}),
		);

		it.live("rejects moves outside the parent, to unseen episodes and off episode records", () =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { client: stranger } = yield* createAuthenticatedClient();
				const show = yield* seedShow(client, {
					seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }] }],
				});
				const otherShow = yield* seedShow(client, {
					seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }] }],
				});
				const hidden = yield* seedShow(stranger, {
					seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }] }],
				});
				const movie = yield* createBuiltinMediaLifecycleFixture(client, {
					entitySchemaSlug: "movie",
				});
				yield* logEpisodeCompletions(client, show.show.id, [show.episodeId(1, 1)]);
				yield* logMediaActivity(client, {
					submittedAt: nowIso(),
					submissionId: yield* randomUuid,
					entry: { kind: "complete", when: { kind: "now" }, entityId: movie.entityId },
				});
				const episodeEvent = yield* episodeCompletion(client, show.episodeId(1, 1));
				const [movieEvent] = yield* readEvents(client, movie.entityId, "complete");
				assertPresent(movieEvent, "Expected the movie completion");

				for (const [event, from, to] of [
					[episodeEvent, show.episodeId(1, 1), otherShow.episodeId(1, 1)],
					[episodeEvent, show.episodeId(1, 1), hidden.episodeId(1, 1)],
					[movieEvent, movie.entityId, show.episodeId(1, 1)],
				] as const) {
					const failure = yield* Effect.flip(retargetEpisode(client, event, from, to));
					assertTaggedError(failure, "PluginOperationRejected");
					expect(failure.message).not.toBe("");
				}
				expect((yield* episodeCompletion(client, show.episodeId(1, 1))).id).toBe(episodeEvent.id);
			}),
		);
	});
});
