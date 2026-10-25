import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { ConsumedItem, ConsumptionBasis } from "@ryot-app/media-plugin/shared/consumption";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	listEventSchemas,
	waitForCreateEvents,
} from "~/fixtures/kernel";
import { requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import {
	createBuiltinMediaLifecycleFixture,
	findMediaEntitySchema,
	mediaReferenceForEntity,
	seedShow,
} from "~/fixtures/plugins/media";
import {
	mediaConsumptionMeasure,
	requireMediaConsumptionGroup,
	waitForMediaConsumptionReport,
} from "~/fixtures/plugins/media/consumption";
import {
	historyEventsFor,
	settledHistoryCorrection,
} from "~/fixtures/plugins/media/history-correction";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const reportNow = Date.parse("2026-01-05T12:00:00.000Z");

const allTime: ReportingSelection = {
	grouping: "day",
	comparison: "none",
	range: { kind: "all-time" },
};

const onCalendarDay = (date: string): ReportingSelection => ({
	grouping: "day",
	comparison: "none",
	range: { endDate: date, kind: "custom", startDate: date },
});

describe("Media consumption projection and reporting", () => {
	it.live(
		"repairs exact book progress in the canonical report and preserves calendar-day attribution",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const book = yield* createBuiltinMediaLifecycleFixture(client, {
					entitySchemaSlug: "book",
					properties: { pages: 100 },
				});
				const created = yield* client.call((c) =>
					c.events.create({
						payload: [
							{
								entityId: book.entityId,
								occurredAt: "2026-01-01T12:00:00.000Z",
								eventSchemaSlug: book.progressEventSchemaSlug,
								properties: { progressPages: 40, calendarDate: "2026-01-01" },
							},
							{
								entityId: book.entityId,
								occurredAt: "2026-01-02T12:00:00.000Z",
								eventSchemaSlug: book.progressEventSchemaSlug,
								properties: { progressPages: 70, calendarDate: "2026-01-02" },
							},
							{
								entityId: book.entityId,
								occurredAt: "2026-01-03T12:00:00.000Z",
								properties: { calendarDate: "2026-01-03" },
								eventSchemaSlug: book.completeEventSchemaSlug,
							},
						],
					}),
				);
				const written = yield* waitForCreateEvents(client, created);
				expect(written.failure).toBeNull();
				expect(written.outcomes.map((outcome) => outcome.status)).toEqual([
					"written",
					"written",
					"written",
				]);
				yield* settledHistoryCorrection(client, userId);

				const reference = yield* mediaReferenceForEntity(client, book.entityId);
				const report = yield* waitForMediaConsumptionReport(client, {
					reference,
					now: reportNow,
					selection: allTime,
					entityId: book.entityId,
					timeZone: TimeZone.make("UTC"),
				});
				expect(report.processing).toBe("ready");
				const allTimeBook = requireMediaConsumptionGroup(report, "book");
				const allTimePages = yield* mediaConsumptionMeasure(allTimeBook, "pages");
				expect(allTimePages.total).toBe(100);
				expect(allTimeBook.titleCompletions).toBe(1);

				for (const timeZone of [TimeZone.make("UTC"), TimeZone.make("America/New_York")]) {
					const jan2 = yield* waitForMediaConsumptionReport(client, {
						timeZone,
						reference,
						now: reportNow,
						entityId: book.entityId,
						selection: onCalendarDay("2026-01-02"),
					});
					const jan2Pages = yield* mediaConsumptionMeasure(
						requireMediaConsumptionGroup(jan2, "book"),
						"pages",
					);
					expect(jan2Pages.total).toBe(30);
				}

				const firstProgress = requirePresent(
					(yield* historyEventsFor(client, book.entityId)).find(
						(event) =>
							event.eventSchemaSlug === "progress" &&
							Schema.is(Schema.Finite)(event.properties["progressPages"]) &&
							event.properties["progressPages"] === 40,
					),
					"First book progress missing",
				);
				yield* client.call((c) => c.events.delete({ params: { eventId: firstProgress.id } }));
				yield* settledHistoryCorrection(client, userId);

				const repaired = yield* waitForMediaConsumptionReport(client, {
					reference,
					now: reportNow,
					selection: allTime,
					entityId: book.entityId,
					timeZone: TimeZone.make("UTC"),
				});
				const repairedBook = requireMediaConsumptionGroup(repaired, "book");
				const repairedPages = yield* mediaConsumptionMeasure(repairedBook, "pages");
				expect(repairedPages.total).toBe(100);
				expect(repairedBook.titleCompletions).toBe(1);
				for (const timeZone of [TimeZone.make("UTC"), TimeZone.make("America/New_York")]) {
					const jan2 = yield* waitForMediaConsumptionReport(client, {
						timeZone,
						reference,
						now: reportNow,
						entityId: book.entityId,
						selection: onCalendarDay("2026-01-02"),
					});
					const jan2Pages = yield* mediaConsumptionMeasure(
						requireMediaConsumptionGroup(jan2, "book"),
						"pages",
					);
					expect(jan2Pages.total).toBe(70);
				}
			}),
	);

	it.live(
		"replays percentage estimates from each frozen runtime basis and keeps undated runs out of periods",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const movie = yield* createBuiltinMediaLifecycleFixture(client, {
					entitySchemaSlug: "movie",
					properties: { runtime: 100 },
				});
				const sourceRun = yield* randomUuid;
				const created = yield* client.call((c) =>
					c.events.create({
						payload: [
							{
								entityId: movie.entityId,
								occurredAt: "2026-01-01T12:00:00.000Z",
								eventSchemaSlug: movie.progressEventSchemaSlug,
								properties: {
									sourceRun,
									progressPercent: 50,
									calendarDate: "2026-01-01",
									consumptionBasis: { total: 100, unit: "minutes", property: "runtime" },
								},
							},
							{
								entityId: movie.entityId,
								occurredAt: "2026-01-02T12:00:00.000Z",
								eventSchemaSlug: movie.progressEventSchemaSlug,
								properties: {
									sourceRun,
									progressPercent: 100,
									calendarDate: "2026-01-02",
									consumptionBasis: { total: 200, unit: "minutes", property: "runtime" },
								},
							},
						],
					}),
				);
				const written = yield* waitForCreateEvents(client, created);
				expect(written.failure).toBeNull();
				expect(written.outcomes.map((outcome) => outcome.status)).toEqual(["written", "written"]);
				yield* settledHistoryCorrection(client, userId);

				const reference = yield* mediaReferenceForEntity(client, movie.entityId);
				const initial = yield* waitForMediaConsumptionReport(client, {
					reference,
					now: reportNow,
					selection: allTime,
					entityId: movie.entityId,
					timeZone: TimeZone.make("UTC"),
				});
				const initialMovie = requireMediaConsumptionGroup(initial, "movie");
				const initialMinutes = yield* mediaConsumptionMeasure(initialMovie, "minutes");
				expect(initialMinutes.total).toBe(150);
				expect(initialMinutes.recorded).toBe(0);
				expect(initialMinutes.estimated).toBe(150);
				expect(initialMovie.titleCompletions).toBe(1);

				const sourceEvents = (yield* historyEventsFor(client, movie.entityId)).filter(
					(event) =>
						event.eventSchemaSlug === "progress" &&
						Schema.is(Schema.String)(event.properties["sourceRun"]) &&
						event.properties["sourceRun"] === sourceRun,
				);
				expect(
					[
						...(yield* Effect.forEach(sourceEvents, (event) =>
							Effect.gen(function* () {
								return {
									progressPercent: yield* Schema.decodeUnknownEffect(Schema.Finite)(
										event.properties["progressPercent"],
									),
									consumptionBasis: yield* Schema.decodeUnknownEffect(ConsumptionBasis)(
										event.properties["consumptionBasis"],
									),
								};
							}),
						)),
					].sort((left, right) => left.progressPercent - right.progressPercent),
				).toEqual([
					{
						progressPercent: 50,
						consumptionBasis: { total: 100, unit: "minutes", property: "runtime" },
					},
					{
						progressPercent: 100,
						consumptionBasis: { total: 200, unit: "minutes", property: "runtime" },
					},
				]);

				const unknownRun = yield* randomUuid;
				const unknownFinish = yield* client.call((c) =>
					c.events.create({
						payload: [
							{
								entityId: movie.entityId,
								occurredAt: "2026-01-02T18:00:00.000Z",
								eventSchemaSlug: movie.completeEventSchemaSlug,
								properties: {
									dateUnknown: true,
									sourceRun: unknownRun,
									consumptionBasis: { total: 100, unit: "minutes", property: "runtime" },
								},
							},
						],
					}),
				);
				const unknownWritten = yield* waitForCreateEvents(client, unknownFinish);
				expect(unknownWritten.failure).toBeNull();
				expect(unknownWritten.outcomes.map((outcome) => outcome.status)).toEqual(["written"]);
				yield* settledHistoryCorrection(client, userId);

				const withUnknown = yield* waitForMediaConsumptionReport(client, {
					reference,
					now: reportNow,
					selection: allTime,
					entityId: movie.entityId,
					timeZone: TimeZone.make("UTC"),
				});
				const allTimeMovie = requireMediaConsumptionGroup(withUnknown, "movie");
				const allTimeMinutes = yield* mediaConsumptionMeasure(allTimeMovie, "minutes");
				expect(allTimeMinutes.total).toBe(250);
				expect(allTimeMovie.titleCompletions).toBe(2);
				expect(withUnknown.unknownDate).toBe(1);

				const dated = yield* waitForMediaConsumptionReport(client, {
					reference,
					now: reportNow,
					entityId: movie.entityId,
					timeZone: TimeZone.make("UTC"),
					selection: {
						grouping: "day",
						comparison: "none",
						range: { kind: "custom", endDate: "2026-01-02", startDate: "2026-01-01" },
					},
				});
				const datedMinutes = yield* mediaConsumptionMeasure(
					requireMediaConsumptionGroup(dated, "movie"),
					"minutes",
				);
				expect(datedMinutes.total).toBe(150);
				for (const timeZone of [TimeZone.make("UTC"), TimeZone.make("America/New_York")]) {
					const jan2 = yield* waitForMediaConsumptionReport(client, {
						timeZone,
						reference,
						now: reportNow,
						entityId: movie.entityId,
						selection: onCalendarDay("2026-01-02"),
					});
					const jan2Minutes = yield* mediaConsumptionMeasure(
						requireMediaConsumptionGroup(jan2, "movie"),
						"minutes",
					);
					expect(jan2Minutes.total).toBe(100);
				}
			}),
	);

	it.live("counts independent Manga item occurrences without inferring cumulative progress", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const manga = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "manga",
				properties: { volumes: 2, chapters: 100 },
			});
			const { schema } = yield* findMediaEntitySchema(client, "manga");
			const itemComplete = requireEventSchemaBySlug(
				yield* listEventSchemas(client, schema.reference),
				"item-complete",
			);
			const created = yield* client.call((c) =>
				c.events.create({
					payload: ["first", "second"].map((sourceRun, index) => ({
						entityId: manga.entityId,
						eventSchemaSlug: itemComplete.id,
						occurredAt: `2026-01-0${index + 1}T12:00:00.000Z`,
						properties: {
							sourceRun: `${sourceRun}-${crypto.randomUUID()}`,
							consumedItem: { volume: 2, position: 12.5, unit: "chapters" },
							consumptionBasis: { total: 100, unit: "chapters", property: "chapters" },
						},
					})),
				}),
			);
			const written = yield* waitForCreateEvents(client, created);
			expect(written.failure).toBeNull();
			expect(written.outcomes.map((outcome) => outcome.status)).toEqual(["written", "written"]);
			yield* settledHistoryCorrection(client, userId);

			const reference = yield* mediaReferenceForEntity(client, manga.entityId);
			const report = yield* waitForMediaConsumptionReport(client, {
				reference,
				now: reportNow,
				selection: allTime,
				entityId: manga.entityId,
				timeZone: TimeZone.make("UTC"),
			});
			const mangaGroup = requireMediaConsumptionGroup(report, "manga");
			const mangaChapters = yield* mediaConsumptionMeasure(mangaGroup, "chapters");
			expect(mangaChapters.total).toBe(2);
			expect(mangaChapters.recorded).toBe(2);
			expect(mangaGroup.titleCompletions).toBe(0);

			const itemEvents = (yield* historyEventsFor(client, manga.entityId)).filter(
				(event) => event.eventSchemaSlug === itemComplete.id,
			);
			expect(itemEvents).toHaveLength(2);
			const sourceRuns = yield* Effect.forEach(itemEvents, (event) =>
				Schema.decodeUnknownEffect(Schema.String)(event.properties["sourceRun"]),
			);
			expect(new Set(sourceRuns).size).toBe(2);
			for (const event of itemEvents) {
				expect(
					yield* Schema.decodeUnknownEffect(ConsumedItem)(event.properties["consumedItem"]),
				).toEqual({ volume: 2, position: 12.5, unit: "chapters" });
				expect(event.properties).not.toHaveProperty("mangaChapter");
				expect(event.properties).not.toHaveProperty("mangaVolume");
				expect(event.properties).not.toHaveProperty("progressPercent");
			}
			expect(
				(yield* historyEventsFor(client, manga.entityId)).filter(
					(event) => event.eventSchemaSlug === "progress" || event.eventSchemaSlug === "complete",
				),
			).toHaveLength(0);
		}),
	);

	it.live(
		"keeps show episode duration separate from parent completions and preserves suppression",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const show = yield* seedShow(client, {
					properties: { productionStatus: "Ended" },
					seasons: [
						{
							seasonNumber: 1,
							episodes: [
								{ episodeNumber: 1, publishDate: "2020-01-01", properties: { runtime: 20 } },
								{ episodeNumber: 2, publishDate: "2020-01-02", properties: { runtime: 30 } },
							],
						},
					],
				});
				const { schema: episodeSchema } = yield* findMediaEntitySchema(client, "show-episode");
				const complete = requireEventSchemaBySlug(
					yield* listEventSchemas(client, episodeSchema.reference),
					"complete",
				);
				const firstEpisode = requirePresent(show.episodes[0], "First show episode missing");
				const secondEpisode = requirePresent(show.episodes[1], "Second show episode missing");
				const episodes = [firstEpisode, secondEpisode];
				const created = yield* client.call((c) =>
					c.events.create({
						payload: episodes.map((episode, index) => ({
							properties: {},
							entityId: episode.id,
							eventSchemaSlug: complete.id,
							occurredAt: `2026-01-0${index + 1}T12:00:00.000Z`,
						})),
					}),
				);
				const written = yield* waitForCreateEvents(client, created);
				expect(written.failure).toBeNull();
				expect(written.outcomes.map((outcome) => outcome.status)).toEqual(["written", "written"]);
				yield* settledHistoryCorrection(client, userId);

				const reference = yield* mediaReferenceForEntity(client, show.show.id);
				const reportInput = {
					reference,
					now: reportNow,
					selection: allTime,
					timeZone: TimeZone.make("UTC"),
				};
				const initial = yield* waitForMediaConsumptionReport(client, reportInput);
				const parentGroup = requireMediaConsumptionGroup(initial, "show");
				const episodeGroup = requireMediaConsumptionGroup(initial, "show-episode");
				const initialEpisodeMinutes = yield* mediaConsumptionMeasure(episodeGroup, "minutes");
				const initialParentMinutes = yield* mediaConsumptionMeasure(parentGroup, "minutes");
				expect(initialEpisodeMinutes.total).toBe(50);
				expect(initialParentMinutes.total).toBe(0);
				expect(parentGroup.titleCompletions).toBe(1);
				expect(episodeGroup.titleCompletions).toBe(0);
				expect(episodeGroup.episodeCompletions).toBe(2);

				const parentCompletion = requirePresent(
					(yield* historyEventsFor(client, show.show.id)).find(
						(event) =>
							event.eventSchemaSlug === "complete" &&
							Schema.is(Schema.String)(event.properties["completionKey"]),
					),
					"Automatic parent completion missing",
				);
				yield* client.call((c) => c.events.delete({ params: { eventId: parentCompletion.id } }));
				yield* settledHistoryCorrection(client, userId);

				const suppressed = yield* waitForMediaConsumptionReport(client, reportInput);
				const suppressedEpisodes = requireMediaConsumptionGroup(suppressed, "show-episode");
				const suppressedEpisodeMinutes = yield* mediaConsumptionMeasure(
					suppressedEpisodes,
					"minutes",
				);
				expect(suppressed.current.types.filter(({ mediaType }) => mediaType === "show")).toEqual(
					[],
				);
				expect(suppressedEpisodeMinutes.total).toBe(50);
				expect(suppressedEpisodes.episodeCompletions).toBe(2);
				expect(
					(yield* historyEventsFor(client, show.show.id)).filter(
						(event) => event.eventSchemaSlug === "complete",
					),
				).toHaveLength(0);

				const firstEpisodeCompletion = requirePresent(
					(yield* historyEventsFor(client, firstEpisode.id)).find(
						(event) => event.eventSchemaSlug === complete.id,
					),
					"First explicit episode completion missing",
				);
				yield* client.call((c) =>
					c.events.update({
						params: { eventId: firstEpisodeCompletion.id },
						payload: { occurredAt: "2026-01-03T12:00:00.000Z" },
					}),
				);
				yield* settledHistoryCorrection(client, userId);

				const edited = yield* waitForMediaConsumptionReport(client, reportInput);
				const editedEpisodeMinutes = yield* mediaConsumptionMeasure(
					requireMediaConsumptionGroup(edited, "show-episode"),
					"minutes",
				);
				expect(editedEpisodeMinutes.total).toBe(50);
				expect(edited.current.types.filter(({ mediaType }) => mediaType === "show")).toEqual([]);
				expect(requireMediaConsumptionGroup(edited, "show-episode").episodeCompletions).toBe(2);
				expect(
					(yield* historyEventsFor(client, show.show.id)).filter(
						(event) => event.eventSchemaSlug === "complete",
					),
				).toHaveLength(0);
			}),
	);
});
