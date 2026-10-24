import type { ContractPayload } from "@ryot-app/contract/client";
import {
	type ReportingSelection,
	resolveReportingSelection,
} from "@ryot-app/contract/modules/analytics/reporting";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	mediaAnalyticsConsistencyRecipe,
	mediaAnalyticsHoursRecipe,
	mediaAnalyticsPeriods,
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsRecordsRecipe,
	mediaAnalyticsStatsRecipe,
	mediaAnalyticsTrendRecipe,
} from "@ryot-app/media-plugin/shared/analytics-recipes";
import { animeRecipes } from "@ryot-app/media-plugin/shared/anime-recipes";
import { consumptionBasisFor } from "@ryot-app/media-plugin/shared/consumption";
import type { Recipe } from "@ryot-app/ryotql";
import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { createCollection } from "~/fixtures/kernel/collections";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { waitForCreateEvents } from "~/fixtures/kernel/events";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { deleteUserAndWait } from "~/fixtures/kernel/user-lifecycle";
import { createMediaAnalyticsFixture } from "~/fixtures/plugins/media/analytics";
import {
	requireMediaConsumptionGroup,
	waitForMediaConsumptionReport,
} from "~/fixtures/plugins/media/consumption";
import { findMediaEntitySchema } from "~/fixtures/plugins/media/entity-schemas";
import { settledHistoryCorrection } from "~/fixtures/plugins/media/history-correction";
import { seedMediaEntity } from "~/fixtures/plugins/media/media";
import { assertCondition, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const allTime: ReportingSelection = {
	grouping: "day",
	comparison: "none",
	range: { kind: "all-time" },
};

const analyticsInput = (
	fixture: Effect.Success<ReturnType<typeof createMediaAnalyticsFixture>>,
) => ({
	now: fixture.now,
	timeZone: fixture.timeZone,
	reference: fixture.reference,
	selection: fixture.reportingSelection,
	periods: mediaAnalyticsPeriods(
		resolveReportingSelection(fixture.reportingSelection, {
			now: fixture.now,
			timeZone: fixture.timeZone,
		}),
	),
});

const pagingInstants = Array.from({ length: 101 }, (_, index) =>
	new Date(Date.parse("2026-09-04T19:00:00.000Z") + Math.floor(index / 2) * 1000).toISOString(),
);

describe("Media analytics supplemental SQL recipes", () => {
	it.live("decodes exact period, all-time, rating-only and account-scoped totals", () =>
		Effect.gen(function* () {
			const fixture = yield* createMediaAnalyticsFixture();
			const { report, account, entities, expectedSourceValues } = fixture;
			const { client } = account;
			const input = analyticsInput(fixture);
			const collection = yield* createCollection(client);
			const collectionReview = requireEventSchemaBySlug(
				yield* listEventSchemas(client, {
					owner: { kind: "kernel" },
					slug: EntitySchemaSlug.make("collection"),
				}),
				"review",
			);
			const created = yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: collection.id,
							properties: { rating: 100 },
							eventSchemaSlug: collectionReview.id,
							occurredAt: "2026-09-03T12:00:00.000Z",
						},
					],
				}),
			);
			const written = yield* waitForCreateEvents(client, created);
			expect(written.failure).toBeNull();
			expect(written.outcomes.map(({ status }) => status)).toEqual(["written"]);

			const stats = yield* executeRyotQLRecipe(client, mediaAnalyticsStatsRecipe(input));
			expect(stats.current.global).toMatchObject({
				pagesKnown: 2,
				minutesKnown: 1,
				episodesKnown: 1,
				activeDays: expectedSourceValues.activeDays,
				distinctTitles: expectedSourceValues.distinctTitles,
			});
			expect(stats.current.types.items).toMatchObject([
				{ activeDays: 1, episodesKnown: 1, distinctTitles: 0, mediaType: "anime" },
				{ activeDays: 2, pagesKnown: 2, mediaType: "book", distinctTitles: 1 },
				{ activeDays: 2, minutesKnown: 1, distinctTitles: 1, mediaType: "movie" },
			]);
			expect(stats.current.types.pageInfo?.hasMore).toBe(false);
			expect(stats.previous?.global).toMatchObject({ activeDays: 0, distinctTitles: 0 });
			expect(stats.previous?.types.items).toEqual([]);
			expect(stats.reviews.current.global).toEqual(expectedSourceValues.reviews);
			expect(stats.reviews.current.types.items).toEqual([
				{ rated: 1, reviews: 1, averageRating: 0, mediaType: "book" },
				{ rated: 1, reviews: 1, averageRating: 80, mediaType: "movie" },
			]);
			expect(stats.reviews.previous?.global).toEqual({
				reviews: 0,
				rated: null,
				averageRating: null,
			});
			const bookStats = yield* executeRyotQLRecipe(
				client,
				mediaAnalyticsStatsRecipe({ ...input, entityId: entities.book.id }),
			);
			expect(bookStats.reviews.current.global).toEqual({ rated: 1, reviews: 1, averageRating: 0 });
			for (const expected of expectedSourceValues.canonical) {
				expect(requireMediaConsumptionGroup(report, expected.mediaType)).toMatchObject(expected);
			}
			expect(report.current.items.reduce((sum, row) => sum + (row.titleCompletions ?? 0), 0)).toBe(
				3,
			);
			expect(report.current.items.reduce((sum, row) => sum + (row.unknownDate ?? 0), 0)).toBe(1);
			const previous = requirePresent(report.previous, "Expected previous Media totals");
			expect(previous.items).toHaveLength(3);
			for (const row of previous.items) {
				expect(row).toMatchObject({
					pagesRecorded: 0,
					pagesEstimated: 0,
					minutesMissing: 0,
					minutesRecorded: 0,
					titleCompletions: 0,
					episodesRecorded: 0,
					minutesEstimated: 0,
					activeObservations: 0,
				});
			}

			const lifetimeInput = {
				...input,
				selection: allTime,
				periods: mediaAnalyticsPeriods(resolveReportingSelection(allTime, input)),
			};
			const lifetime = yield* waitForMediaConsumptionReport(client, lifetimeInput);
			expect(requireMediaConsumptionGroup(lifetime, "movie")).toMatchObject({
				unknownDate: 1,
				minutesMissing: 2,
				minutesRecorded: 0,
				titleCompletions: 3,
				minutesEstimated: 0,
				activeObservations: 3,
			});
			const lifetimeStats = yield* executeRyotQLRecipe(
				client,
				mediaAnalyticsStatsRecipe(lifetimeInput),
			);
			expect(lifetimeStats.current.global).toMatchObject({
				activeDays: 3,
				minutesKnown: 1,
				distinctTitles: 2,
			});
			expect(lifetimeStats.previous).toBeNull();

			const other = yield* createAuthenticatedClient();
			yield* Effect.addFinalizer(() =>
				deleteUserAndWait(other.userId, other.client.target).pipe(Effect.ignore),
			);
			const isolated = yield* executeRyotQLRecipe(
				other.client,
				mediaAnalyticsStatsRecipe({ ...input, entityId: entities.book.id }),
			);
			expect(isolated.current.global).toMatchObject({ activeDays: 0, distinctTitles: 0 });
			expect(isolated.current.types.items).toEqual([]);
			expect(isolated.reviews.current.global).toMatchObject({ reviews: 0 });
			expect(
				(yield* executeRyotQLRecipe(other.client, mediaAnalyticsRecordsRecipe(input))).items,
			).toEqual([]);
		}),
	);

	it.live(
		"decodes bounded daily trends, timed hours and the union of calendar and instant days",
		() =>
			Effect.gen(function* () {
				const fixture = yield* createMediaAnalyticsFixture();
				const { client } = fixture.account;
				const input = analyticsInput(fixture);
				const window = requirePresent(input.periods.current, "Expected the fixed reporting window");
				const trend = yield* executeRyotQLRecipe(
					client,
					mediaAnalyticsTrendRecipe({ ...input, window }),
				);
				expect(trend.pageInfo?.hasMore).toBe(false);
				expect(
					trend.items.map(({ at, mediaType, precision, activeObservations }) => ({
						at,
						mediaType,
						precision,
						activeObservations,
					})),
				).toEqual([
					{ at: "2026-09-02", mediaType: "anime", precision: "instant", activeObservations: 1 },
					{ at: "2026-09-02", mediaType: "book", precision: "date", activeObservations: 1 },
					{ at: "2026-09-02", mediaType: "movie", precision: "instant", activeObservations: 1 },
					{ at: "2026-09-04", mediaType: "book", precision: "date", activeObservations: 1 },
					{ at: "2026-09-05", mediaType: "movie", precision: "instant", activeObservations: 1 },
				]);
				expect(trend.items.reduce((sum, row) => sum + (row.activeObservations ?? 0), 0)).toBe(5);
				expect(trend.items.reduce((sum, row) => sum + (row.titleCompletions ?? 0), 0)).toBe(3);
				expect(trend.items.reduce((sum, row) => sum + (row.pagesRecorded ?? 0), 0)).toBe(40);
				expect(trend.items.reduce((sum, row) => sum + (row.pagesEstimated ?? 0), 0)).toBe(60);
				expect(trend.items.reduce((sum, row) => sum + (row.episodesRecorded ?? 0), 0)).toBe(1);
				expect(trend.items.reduce((sum, row) => sum + (row.minutesMissing ?? 0), 0)).toBe(1);
				const previousTrend = yield* executeRyotQLRecipe(
					client,
					mediaAnalyticsTrendRecipe({
						...input,
						period: "previous",
						window: requirePresent(input.periods.previous, "Expected a previous reporting window"),
					}),
				);
				expect(previousTrend.items).toEqual([]);
				const hours = yield* executeRyotQLRecipe(client, mediaAnalyticsHoursRecipe(input));
				expect(hours.pageInfo?.hasMore).toBe(false);
				expect(hours.items).toMatchObject([
					{
						hour: 18,
						minutesKnown: 1,
						minutesMissing: 1,
						mediaType: "movie",
						minutesRecorded: 0,
						titleCompletions: 2,
						minutesEstimated: 0,
						activeObservations: 2,
					},
					{
						hour: 19,
						episodesKnown: 1,
						mediaType: "anime",
						titleCompletions: 0,
						episodesRecorded: 1,
						activeObservations: 1,
					},
				]);
				const consistency = yield* executeRyotQLRecipe(
					client,
					mediaAnalyticsConsistencyRecipe({ ...input, window }),
				);
				expect(consistency.hasMore).toBe(false);
				expect(consistency.days).toEqual(fixture.expectedSourceValues.consistency);
				expect(consistency.days).toHaveLength(fixture.expectedSourceValues.activeDays);
			}),
	);

	it.live("orders rankings and pages more than 100 filtered source records with real cursors", () =>
		Effect.gen(function* () {
			const fixture = yield* createMediaAnalyticsFixture();
			const { account, entities, sourceEventIds } = fixture;
			const { client } = account;
			const input = analyticsInput(fixture);
			const ranking = yield* executeRyotQLRecipe(client, mediaAnalyticsRankingRecipe(input));
			const tied = [entities.book.id, entities.movie.id].sort();
			expect(ranking.items.map(({ entityId }) => entityId)).toEqual([...tied, entities.anime.id]);
			expect(ranking.items.map(({ activeObservations }) => activeObservations)).toEqual([2, 2, 1]);
			expect(ranking.pageInfo).toEqual({ limit: 100, hasMore: false, nextCursor: null });
			const movieRanking = yield* executeRyotQLRecipe(
				client,
				mediaAnalyticsRankingRecipe({ ...input, mediaType: "movie" }),
			);
			expect(movieRanking.items).toMatchObject([
				{ titleCompletions: 2, activeObservations: 2, entityId: entities.movie.id },
			]);

			const batch: ContractPayload<"events", "create"> = pagingInstants.map((occurredAt) => ({
				occurredAt,
				entityId: entities.anime.id,
				eventSchemaSlug: requireEventSchemaBySlug(entities.anime.eventSchemas, "item-complete").id,
				properties: {
					sourceRun: crypto.randomUUID(),
					consumedItem: { position: 7, unit: "episodes" },
					consumptionBasis: consumptionBasisFor("anime", { episodes: 12 }),
				},
			}));
			const created = yield* client.call((c) => c.events.create({ payload: batch }));
			const written = yield* waitForCreateEvents(client, created);
			expect(written.failure).toBeNull();
			expect(written.outcomes).toHaveLength(batch.length);
			const additionalIds = written.outcomes.map((outcome) => {
				assertCondition(outcome.status === "written", "Expected each paging source to save");
				return outcome.eventId;
			});
			yield* settledHistoryCorrection(client, account.userId);
			const repaired = yield* waitForMediaConsumptionReport(client, input);
			expect(requireMediaConsumptionGroup(repaired, "anime")).toMatchObject({
				titleCompletions: 0,
				episodesRecorded: 102,
				activeObservations: 102,
			});

			const history: Recipe.Success<typeof animeRecipes.historyRecipe>["items"][number][] = [];
			let before: string | undefined;
			do {
				const page = yield* executeRyotQLRecipe(
					client,
					animeRecipes.historyRecipe({
						before,
						limit: 100,
						entityId: entities.anime.id,
						reference: fixture.reference,
					}),
				);
				history.push(...page.items);
				before = page.pageInfo.hasMore
					? requirePresent(page.pageInfo.nextCursor, "Expected the next source history cursor")
					: undefined;
			} while (before !== undefined);
			const animeSourceIds = new Set([
				...additionalIds,
				requirePresent(sourceEventIds[5], "Expected the initial independent Anime item"),
			]);
			const expectedOrder = history.filter(({ id }) => animeSourceIds.has(id)).map(({ id }) => id);
			expect(expectedOrder).toHaveLength(102);
			const recordInput = {
				...input,
				hour: 19,
				activeOnly: true,
				mediaType: "anime",
				entityId: entities.anime.id,
			};
			const first = yield* executeRyotQLRecipe(client, mediaAnalyticsRecordsRecipe(recordInput));
			expect(first.items).toHaveLength(100);
			expect(first.pageInfo.hasMore).toBe(true);
			const after = requirePresent(first.pageInfo.nextCursor, "Expected a real records cursor");
			const second = yield* executeRyotQLRecipe(
				client,
				mediaAnalyticsRecordsRecipe({ ...recordInput, after }),
			);
			expect(second.items).toHaveLength(2);
			expect(second.pageInfo).toEqual({ limit: 100, hasMore: false, nextCursor: null });
			const records = [...first.items, ...second.items];
			expect(records.map(({ id }) => id)).toEqual(expectedOrder);
			expect(new Set(records.map(({ id }) => id)).size).toBe(102);
			expect(new Set(records.map(({ facts }) => facts.sourceRun)).size).toBe(102);
			for (const row of records) {
				expect(row).toMatchObject({
					eventType: "item-complete",
					entityId: entities.anime.id,
					contribution: {
						titleCompletions: 0,
						activeObservation: true,
						episodes: { recorded: 1, estimated: 0, missing: false },
					},
					facts: {
						consumedItem: { position: 7, unit: "episodes" },
						consumptionBasis: { total: 12, unit: "episodes", property: "episodes" },
					},
				});
				expect(row.facts).not.toHaveProperty("animeEpisode");
				expect(row.facts).not.toHaveProperty("progressPercent");
			}
			const movieRecords = yield* executeRyotQLRecipe(
				client,
				mediaAnalyticsRecordsRecipe({
					...input,
					hour: 18,
					mediaType: "movie",
					entityId: entities.movie.id,
				}),
			);
			expect(movieRecords.items.map(({ id }) => id)).toEqual([
				sourceEventIds[3],
				sourceEventIds[2],
			]);
			expect(movieRecords.pageInfo.hasMore).toBe(false);
			const wrongHour = yield* executeRyotQLRecipe(
				client,
				mediaAnalyticsRecordsRecipe({ ...recordInput, hour: 18 }),
			);
			expect(wrongHour.items).toEqual([]);
		}),
	);

	it.live("pages entity-root rankings beyond 100 media entities with a real cursor", () =>
		Effect.gen(function* () {
			const fixture = yield* createMediaAnalyticsFixture();
			const { client } = fixture.account;
			const { book } = fixture.entities;
			const input = analyticsInput(fixture);
			const bookSchema = yield* findMediaEntitySchema(client, "book");
			const providerId = requirePresent(
				bookSchema.schema.providers[0]?.providerId,
				"Missing built-in book provider",
			);
			const complete = requireEventSchemaBySlug(book.eventSchemas, "complete");
			const additions = yield* Effect.forEach(
				Array.from({ length: 101 }),
				() =>
					seedMediaEntity({
						providerId,
						userId: null,
						target: client.target,
						entitySchemaSlug: bookSchema.schema.id,
						externalId: `analytics-rank-${crypto.randomUUID()}`,
						name: `Analytics ranking book ${crypto.randomUUID()}`,
						properties: {
							pages: 1,
							isNsfw: null,
							sourceUrl: null,
							description: null,
							publishYear: null,
							providerRating: null,
							productionStatus: null,
						},
					}),
				{ concurrency: 2 },
			);
			const sourceEvents: ContractPayload<"events", "create"> = additions.map((entity) => ({
				entityId: entity.id,
				eventSchemaSlug: complete.id,
				occurredAt: "2026-09-04T20:00:00.000Z",
				properties: {
					sourceRun: crypto.randomUUID(),
					consumptionBasis: consumptionBasisFor("book", { pages: 1 }),
				},
			}));
			for (let offset = 0; offset < sourceEvents.length; offset += 50) {
				const batch = sourceEvents.slice(offset, offset + 50);
				const created = yield* client.call((c) => c.events.create({ payload: batch }));
				const written = yield* waitForCreateEvents(client, created);
				expect(written.failure).toBeNull();
				expect(written.outcomes).toHaveLength(batch.length);
				for (const outcome of written.outcomes) {
					assertCondition(outcome.status === "written", "Expected every ranking source to save");
				}
			}
			yield* settledHistoryCorrection(client, fixture.account.userId);
			const report = yield* waitForMediaConsumptionReport(client, input);
			expect(report.processing).toBe("ready");
			expect(requireMediaConsumptionGroup(report, "book")).toMatchObject({
				pagesRecorded: 40,
				pagesEstimated: 161,
				titleCompletions: 102,
				activeObservations: 103,
			});

			const expectedEntities = [
				book,
				...additions.sort((left, right) => left.id.localeCompare(right.id)),
			];
			const firstPage = yield* executeRyotQLRecipe(
				client,
				mediaAnalyticsRankingRecipe({ ...input, mediaType: "book" }),
			);
			expect(firstPage.items).toHaveLength(100);
			expect(firstPage.items.map(({ entityId }) => entityId)).toEqual(
				expectedEntities.slice(0, 100).map(({ id }) => id),
			);
			expect(firstPage.items.map(({ activeObservations }) => activeObservations)).toEqual([
				2,
				...Array.from({ length: 99 }, () => 1),
			]);
			expect(firstPage.pageInfo.hasMore).toBe(true);
			const after = requirePresent(firstPage.pageInfo.nextCursor, "Expected the ranking cursor");
			const secondPage = yield* executeRyotQLRecipe(
				client,
				mediaAnalyticsRankingRecipe({ ...input, after, mediaType: "book" }),
			);
			expect(secondPage.items).toHaveLength(2);
			expect(secondPage.items.map(({ entityId }) => entityId)).toEqual(
				expectedEntities.slice(100).map(({ id }) => id),
			);
			expect(secondPage.items.map(({ activeObservations }) => activeObservations)).toEqual([1, 1]);
			expect(secondPage.pageInfo).toEqual({ limit: 100, hasMore: false, nextCursor: null });
			const allRows = [...firstPage.items, ...secondPage.items];
			expect(allRows.map(({ entityId }) => entityId)).toEqual(expectedEntities.map(({ id }) => id));
			expect(new Set(allRows.map(({ entityId }) => entityId)).size).toBe(102);
			expect(allRows.map(({ name }) => name)).toEqual(expectedEntities.map(({ name }) => name));
		}),
	);
});
