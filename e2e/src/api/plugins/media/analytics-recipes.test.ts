import type { ContractPayload } from "@ryot-app/contract/client";
import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	mediaAnalyticsHoursRecipe,
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsRecordsRecipe,
	mediaAnalyticsSummaryRecipe,
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
});
const sum = <Row,>(rows: readonly Row[], value: (row: Row) => null | number | undefined) =>
	rows.reduce((total, row) => total + (value(row) ?? 0), 0);

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

			expect(report.current.activeDays).toBe(expectedSourceValues.activeDays);
			expect(sum(report.current.types, (row) => row.distinctTitles)).toBe(
				expectedSourceValues.distinctTitles,
			);
			expect(report.current.types).toMatchObject([
				{ activeDays: 1, episodesKnown: 1, distinctTitles: 0, mediaType: "anime" },
				{ activeDays: 2, pagesKnown: 2, mediaType: "book", distinctTitles: 1 },
				{ activeDays: 2, minutesKnown: 1, distinctTitles: 1, mediaType: "movie" },
			]);
			expect(report.previous).toEqual({ activeDays: 0, types: [], reviews: [] });
			expect(report.current.reviews).toMatchObject([
				{ rated: 1, reviews: 1, averageRating: 0, mediaType: "book" },
				{ rated: 1, reviews: 1, averageRating: 80, mediaType: "movie" },
			]);
			const bookSummary = yield* executeRyotQLRecipe(
				client,
				mediaAnalyticsSummaryRecipe({ ...input, entityId: entities.book.id }),
			);
			expect(bookSummary.current.reviews).toMatchObject([
				{ rated: 1, reviews: 1, averageRating: 0 },
			]);
			for (const expected of expectedSourceValues.canonical) {
				expect(requireMediaConsumptionGroup(report, expected.mediaType)).toMatchObject(expected);
			}
			expect(sum(report.current.types, (row) => row.titleCompletions)).toBe(3);
			expect(report.unknownDate).toBe(1);

			const lifetime = yield* waitForMediaConsumptionReport(client, {
				...input,
				selection: allTime,
			});
			expect(lifetime.unknownDate).toBe(1);
			expect(requireMediaConsumptionGroup(lifetime, "movie")).toMatchObject({
				minutesKnown: 1,
				minutesMissing: 2,
				distinctTitles: 1,
				minutesRecorded: 0,
				titleCompletions: 3,
				minutesEstimated: 0,
				activeObservations: 3,
			});
			expect(lifetime.current.activeDays).toBe(3);
			expect(lifetime.previous).toBeNull();

			const other = yield* createAuthenticatedClient();
			yield* Effect.addFinalizer(() =>
				deleteUserAndWait(other.userId, other.client.target).pipe(Effect.ignore),
			);
			const isolated = yield* executeRyotQLRecipe(
				other.client,
				mediaAnalyticsSummaryRecipe({ ...input, entityId: entities.book.id }),
			);
			expect(isolated.current).toEqual({ activeDays: 0, types: [], reviews: [] });
			expect(
				(yield* executeRyotQLRecipe(other.client, mediaAnalyticsRecordsRecipe(input))).items,
			).toEqual([]);
		}),
	);

	it.live(
		"decodes local-bucket trends with calendar and instant days, and timed hours",
		() =>
			Effect.gen(function* () {
				const fixture = yield* createMediaAnalyticsFixture();
				const { client } = fixture.account;
				const input = analyticsInput(fixture);
				const trend = yield* executeRyotQLRecipe(client, mediaAnalyticsTrendRecipe(input));
				expect(
					trend.current.items.map(({ at, activeObservations }) => ({ at, activeObservations })),
				).toEqual([
					{ at: "2026-09-02", activeObservations: 3 },
					{ at: "2026-09-04", activeObservations: 1 },
					{ at: "2026-09-05", activeObservations: 1 },
				]);
				expect(trend.current.items).toEqual(
					expect.arrayContaining(
						fixture.expectedSourceValues.consistency.map(({ day, events }) =>
							expect.objectContaining({ at: day, activeObservations: events }),
						),
					),
				);
				expect(sum(trend.current.items, (row) => row.titleCompletions)).toBe(3);
				expect(sum(trend.current.items, (row) => row.pagesRecorded)).toBe(40);
				expect(sum(trend.current.items, (row) => row.pagesEstimated)).toBe(60);
				expect(sum(trend.current.items, (row) => row.episodesRecorded)).toBe(1);
				expect(sum(trend.current.items, (row) => row.minutesMissing)).toBe(1);
				expect(trend.previous?.items).toEqual([]);
				const bookTrend = yield* executeRyotQLRecipe(
					client,
					mediaAnalyticsTrendRecipe({ ...input, mediaType: "book" }),
				);
				expect(bookTrend.current.items.map(({ at }) => at)).toEqual(["2026-09-02", "2026-09-04"]);
				const hours = yield* executeRyotQLRecipe(client, mediaAnalyticsHoursRecipe(input));
				expect(hours).toMatchObject([
					{
						hour: 18,
						minutesKnown: 1,
						minutesMissing: 1,
						minutesRecorded: 0,
						titleCompletions: 2,
						minutesEstimated: 0,
						activeObservations: 2,
					},
					{ hour: 19, episodesKnown: 1, titleCompletions: 0, episodesRecorded: 1 },
				]);
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
				...additions.sort((left, right) => {
					if (left.id === right.id) {
						return 0;
					}
					return left.id < right.id ? -1 : 1;
				}),
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
