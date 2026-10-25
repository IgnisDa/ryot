import { describe, expect, it } from "@effect/vitest";
import { validateRyotQLDocument } from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	castBoolean,
	castDate,
	castText,
	column,
	conditional,
	eq,
	literal,
	localDate,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { resolveReportingSelection, TimeZone } from "@ryot-app/plugin-kit/schema";
import { arrayContaining, objectContaining } from "@ryot-app/testing/matchers";
import { Effect } from "effect";

import { mediaActivityRecipe } from "./activity-recipes";
import {
	consumptionActiveDay,
	mediaAnalyticsConsistencyRecipe,
	mediaAnalyticsHoursRecipe,
	type MediaAnalyticsInput,
	mediaAnalyticsPeriods,
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsRecordsRecipe,
	mediaAnalyticsStatsRecipe,
	mediaAnalyticsTrendRecipe,
} from "./analytics-recipes";
import {
	consumptionNumber,
	consumptionValue,
	mediaConsumptionReportRecipe,
} from "./consumption-recipes";

const input = {
	reference: { kind: "self" },
	now: Date.parse("2026-10-29T12:00:00Z"),
	timeZone: TimeZone.make("America/New_York"),
	selection: {
		grouping: "day",
		comparison: "previous-period",
		range: { days: 30, kind: "rolling" },
	},
} as const;
const calendarInput = (value: MediaAnalyticsInput = input) => ({
	...value,
	periods: mediaAnalyticsPeriods(resolveReportingSelection(value.selection, value)),
});
const documentText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const documentHash = Effect.fnUntraced(function* (document: unknown) {
	const text = yield* documentText(document);
	const hash = yield* Effect.promise(() =>
		crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
	);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
});
const aggregate = (items: readonly unknown[], hasMore = false) => ({
	items,
	type: "aggregate",
	pageInfo: { hasMore, limit: 1000 },
});
const rows = (items: readonly unknown[], nextCursor: null | string = null) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
});
const measures = {
	pagesKnown: 0,
	minutesKnown: 0,
	pagesMissing: 0,
	volumesKnown: 0,
	pagesRecorded: 0,
	episodesKnown: 0,
	chaptersKnown: 0,
	minutesMissing: 0,
	pagesEstimated: 0,
	volumesMissing: 0,
	minutesRecorded: 0,
	pagesSuperseded: 0,
	episodesMissing: 0,
	chaptersMissing: 0,
	volumesRecorded: 0,
	titleCompletions: 0,
	minutesEstimated: 0,
	episodesRecorded: 0,
	chaptersRecorded: 0,
	volumesEstimated: 0,
	minutesSuperseded: 0,
	episodesEstimated: 0,
	chaptersEstimated: 0,
	volumesSuperseded: 0,
	episodeCompletions: 0,
	activeObservations: 0,
	episodesSuperseded: 0,
	chaptersSuperseded: 0,
};

describe("supplemental Media analytics recipes", () => {
	it("keeps explicitly captured 28-day current and 31-day prior calendar months when the execution clock advances", () => {
		const captured = calendarInput({
			...input,
			now: Date.parse("2026-03-15T12:00:00Z"),
			selection: {
				grouping: "day",
				comparison: "previous-period",
				range: { offset: -1, unit: "month", kind: "calendar" },
			},
		});
		const later = { ...captured, now: Date.parse("2026-11-02T18:00:00Z") };
		const queries = mediaAnalyticsStatsRecipe(later).document.queries;
		expect(JSON.stringify(queries["currentGlobal"]?.where)).toContain("2026-02-01T05:00:00.000Z");
		expect(JSON.stringify(queries["previousGlobal"]?.where)).toContain("2026-01-01T05:00:00.000Z");
		expect(JSON.stringify(queries["previousGlobal"]?.where)).not.toContain(
			"2026-01-04T05:00:00.000Z",
		);
		const recipe = mediaAnalyticsTrendRecipe({
			...later,
			period: "previous",
			window: { endDate: "2026-01-31", startDate: "2026-01-01" },
		});
		const decoded = Result.getOrThrow(recipe.decode({ data: { trend: aggregate([]) } }));
		expect(decoded.period).toMatchObject({ endDate: "2026-01-31", startDate: "2026-01-01" });
	});
	it.live("retains the exact production report and activity documents", () =>
		Effect.gen(function* () {
			const hashes = [
				"fc4ca20d79573acd90a14355242f6646724534f4f0d3e636ca0df80f2ce92441",
				"3728d1d29962df6456c9bb500d6a484b4300ba90db035dc698fc904f8390e64c",
				"b8cb63e718d8e9514e120bccb04f7bdfe895f2346057e3936594857cd9ce8996",
			];
			const ranges = [
				{ kind: "all-time" },
				{ days: 30, kind: "rolling" },
				{ kind: "custom", endDate: "2026-03-08", startDate: "2026-03-08" },
			] as const;
			for (const [index, range] of ranges.entries()) {
				const report = mediaConsumptionReportRecipe({
					...input,
					selection: { range, grouping: "auto", comparison: "previous-period" },
				});
				expect(Object.keys(report.document.queries)).toEqual([
					"current",
					"previous",
					"rankings",
					"hourly",
					"trends",
					"coverage",
					"reviews",
				]);
				expect(yield* documentHash(report.document)).toBe(hashes[index]);
			}
			const activity = mediaActivityRecipe({
				reference: input.reference,
				from: "2025-09-28T18:30:00.000Z",
				until: "2026-09-25T18:30:00.000Z",
				timeZone: TimeZone.make("Asia/Kolkata"),
			});
			expect(yield* documentHash(activity.document)).toBe(
				"efb78bd59c425b826864ce720697881fceb086f6ce3c5d3e25bb8b7ccc56c7b8",
			);
		}),
	);
	it("counts completed title identities and one canonical calendar key, not rows or per-type day sums", () => {
		const document = mediaAnalyticsStatsRecipe(calendarInput()).document;
		const event = table("event", "analyticsCurrentEvent");
		const global = document.queries["currentGlobal"];
		expect(global?.output).toMatchObject({
			type: "aggregate",
			measures: arrayContaining([
				{
					key: "distinctTitles",
					aggregation: {
						function: "countDistinct",
						expr: conditional(
							{
								operator: "gt",
								right: literal(0),
								type: "comparison",
								left: consumptionNumber(event, "titleCompletions"),
							},
							column(event, "entityId"),
							literal(null),
						),
					},
				},
				{
					key: "activeDays",
					aggregation: {
						function: "countDistinct",
						expr: conditional(
							eq(castBoolean(consumptionValue(event, "activeObservation")), literal(true)),
							consumptionActiveDay(event, input.timeZone),
							literal(null),
						),
					},
				},
			]),
		});
		expect(JSON.stringify(global?.where)).toContain("projectionStatus");
		expect(JSON.stringify(global?.where)).toContain("2026-09-30T04:00:00.000Z");
	});
	it("keeps date-only days and excludes unknown precision from the instant calendar conversion", () => {
		const event = table("event", "source");
		const kind = castText(consumptionValue(event, "attribution", "kind"));
		expect(consumptionActiveDay(event, input.timeZone)).toEqual(
			conditional(
				eq(kind, literal("date")),
				castText(consumptionValue(event, "attribution", "value")),
				conditional(
					eq(kind, literal("instant")),
					localDate(castDate(consumptionValue(event, "attribution", "value")), {
						timeZone: input.timeZone,
					}),
					literal(null),
				),
			),
		);
	});
	it("uses retained unit presence rather than current metadata for known-zero, missing, and superseded charts", () => {
		const recipe = mediaAnalyticsTrendRecipe({
			...calendarInput(),
			window: { endDate: "2026-10-29", startDate: "2026-10-01" },
		});
		const text = JSON.stringify(recipe.document);
		expect(text).toContain("supersededEstimate");
		expect(text).toContain("minutesKnown");
		expect(text).not.toContain("runtime");
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					trend: aggregate(
						[
							{
								...measures,
								pagesKnown: 1,
								mediaType: "book",
								precision: "date",
								at: "2026-10-01T00:00:00Z",
							},
						],
						true,
					),
				},
			}),
		);
		expect(result.items[0]).toMatchObject({ pagesKnown: 1, pagesRecorded: 0, at: "2026-10-01" });
		expect(result.pageInfo?.hasMore).toBe(true);
	});
	it("merges local instant and retained date-only daily observations across DST without fabricating hours", () => {
		const recipe = mediaAnalyticsConsistencyRecipe({
			...calendarInput({
				...input,
				selection: {
					...input.selection,
					range: { kind: "custom", endDate: "2026-11-01", startDate: "2026-11-01" },
				},
			}),
			window: { endDate: "2026-11-01", startDate: "2026-11-01" },
		});
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					dates: aggregate([{ events: 2, day: "2026-11-01" }]),
					instants: aggregate([{ events: 3, day: "2026-11-01T04:00:00.000Z" }]),
				},
			}),
		);
		expect(result.days).toEqual([{ events: 5, day: "2026-11-01" }]);
		expect(result.period).toMatchObject({
			endAt: "2026-11-02T05:00:00.000Z",
			startAt: "2026-11-01T04:00:00.000Z",
		});
		expect(JSON.stringify(recipe.document)).toContain("activeObservation");
		expect(JSON.stringify(recipe.document)).not.toContain('"unknown"');
	});
	it("bounds daily and explicitly grouped chart windows and reports overflow", () => {
		expect(() =>
			mediaAnalyticsTrendRecipe({
				...calendarInput({
					...input,
					selection: { ...input.selection, range: { kind: "all-time" } },
				}),
				window: { endDate: "2026-10-29", startDate: "2025-01-01" },
			}),
		).toThrow("bucket bound");
		expect(() =>
			mediaAnalyticsConsistencyRecipe({
				...calendarInput({
					...input,
					selection: { ...input.selection, range: { kind: "all-time" } },
				}),
				window: { endDate: "2026-10-29", startDate: "2025-01-01" },
			}),
		).toThrow("bucket bound");
		const recipe = mediaAnalyticsConsistencyRecipe({
			...calendarInput(),
			window: { endDate: "2026-10-29", startDate: "2026-10-01" },
		});
		const result = Result.getOrThrow(
			recipe.decode({ data: { instants: aggregate([]), dates: aggregate([], true) } }),
		);
		expect(result.hasMore).toBe(true);
	});
	it("pages real entity roots with preview-compatible zero scores and stable identity ties", () => {
		const recipe = mediaAnalyticsRankingRecipe({
			...input,
			mediaType: "show-episode",
			after: "opaque-ranking-cursor",
		});
		const query = recipe.document.queries["ranking"];
		expect(query?.from).toEqual(table("entity", "analyticsRankEntity"));
		expect(query?.output).toMatchObject({
			type: "rows",
			pagination: { limit: 100, after: "opaque-ranking-cursor" },
			orderBy: [
				{ direction: "desc" },
				{ direction: "asc", expr: column(table("entity", "analyticsRankEntity"), "id") },
			],
		});
		expect(JSON.stringify(query?.where)).toContain('"exists"');
		expect(JSON.stringify(query?.where)).not.toContain('"operator":"gt"');
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					ranking: rows(
						[
							{
								name: "Parent",
								mediaType: "show",
								entityId: "parent",
								titleCompletions: 1,
								activeObservations: 0,
								episodeCompletions: 0,
							},
						],
						"next-opaque",
					),
				},
			}),
		);
		expect(result.items[0]?.activeObservations).toBe(0);
		expect(result.pageInfo.nextCursor).toBe("next-opaque");
	});
	it("keeps source facts and canonical contributions separate in logical-order event cursor rows", () => {
		const recipe = mediaAnalyticsRecordsRecipe({
			...input,
			hour: 1,
			activeOnly: true,
			mediaType: "anime",
			entityId: "owned-title",
			after: "opaque-source-cursor",
		});
		const query = recipe.document.queries["records"];
		expect(query?.output).toMatchObject({
			type: "rows",
			pagination: { after: "opaque-source-cursor" },
			orderBy: [
				{ direction: "desc", expr: { field: "occurredAt" } },
				{ direction: "desc", expr: { field: "orderCreatedAt" } },
				{ direction: "desc", expr: { field: "orderKey" } },
				{ direction: "desc", expr: { field: "id" } },
			],
		});
		const text = JSON.stringify(query?.where);
		for (const value of [
			"owned-title",
			"eventSchemaPluginId",
			"entitySchemaPluginId",
			"item-complete",
			"projectionStatus",
			"attribution",
			"localHour",
		]) {
			expect(text).toContain(value);
		}
		for (const value of ["list-state", '"review"']) {
			expect(text).not.toContain(value);
		}
		const contribution = {
			titleCompletions: 0,
			episodeCompletions: 0,
			activeObservation: true,
			attribution: { kind: "date", value: "2026-10-10" },
			episodes: { recorded: 1, estimated: 0, missing: false, supersededEstimate: false },
		};
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					records: rows([
						{
							id: "item",
							contribution,
							name: "Anime",
							orderKey: "item",
							entityId: "title",
							mediaType: "anime",
							eventType: "item-complete",
							occurredAt: "2026-10-10T00:00:00Z",
							orderCreatedAt: "2026-10-10T00:00:00Z",
							facts: {
								consumedItem: { position: 12, unit: "episodes" },
								sourceProgress: { percent: 50, position: 12, unit: "episodes" },
							},
						},
					]),
				},
			}),
		);
		expect(result.items[0]?.facts.consumedItem?.position).toBe(12);
		expect(result.items[0]?.contribution.episodes?.recorded).toBe(1);
	});
	it("queries review sources independently, including zero ratings and exact overall averages", () => {
		const document = mediaAnalyticsStatsRecipe(calendarInput()).document;
		expect(JSON.stringify(document.queries["currentReviews"]?.where)).not.toContain(
			"projectionStatus",
		);
		expect(JSON.stringify(document.queries["previousReviews"]?.where)).toContain(
			"2026-08-31T04:00:00.000Z",
		);
		const query = document.queries["currentReviews"];
		expect(query?.from.table).toBe("event");
		expect(query?.output).toMatchObject({
			type: "aggregate",
			measures: arrayContaining([
				objectContaining({
					key: "averageRating",
					aggregation: objectContaining({ function: "average" }),
				}),
				objectContaining({
					key: "rated",
					aggregation: objectContaining({
						function: "sum",
						expr: objectContaining({ condition: objectContaining({ type: "isNotNull" }) }),
					}),
				}),
			]),
		});
	});
	it("stays within ordinary plugin document limits", () => {
		const window = { endDate: "2026-10-29", startDate: "2026-10-01" };
		for (const recipe of [
			mediaAnalyticsStatsRecipe(calendarInput()),
			mediaAnalyticsTrendRecipe({ ...calendarInput(), window }),
			mediaAnalyticsConsistencyRecipe({ ...calendarInput(), window }),
			mediaAnalyticsHoursRecipe(calendarInput()),
			mediaAnalyticsRankingRecipe(input),
			mediaAnalyticsRecordsRecipe(input),
		]) {
			expect(
				validateRyotQLDocument(recipe.document, {
					type: "user",
					audience: "plugin",
					accessClass: "standard",
				}).error,
			).toBeNull();
		}
	});
});
