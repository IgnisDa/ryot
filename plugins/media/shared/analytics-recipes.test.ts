import { describe, expect, it } from "@effect/vitest";
import { validateRyotQLDocument } from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import {
	castDate,
	castText,
	conditional,
	eq,
	literal,
	localDate,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { arrayContaining, objectContaining } from "@ryot-app/testing/matchers";

import {
	consumptionMeasures,
	mediaAnalyticsHoursRecipe,
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsRecordsRecipe,
	mediaAnalyticsSummaryRecipe,
	mediaAnalyticsTrendRecipe,
} from "./analytics-recipes";
import { consumptionActiveDay, consumptionValue } from "./consumption-recipes";

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
const aggregate = (items: readonly unknown[]) => ({ items, type: "aggregate", pageInfo: { limit: 100, hasMore: false, nextCursor: null } });
const rows = (items: readonly unknown[], nextCursor: null | string = null) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
});
const validate = (document: Parameters<typeof validateRyotQLDocument>[0]) =>
	validateRyotQLDocument(document, { type: "user", audience: "plugin", accessClass: "standard" })
		.error;
const allTime = {
	...input,
	selection: { ...input.selection, range: { kind: "all-time" } },
} as const;
const zeros = Object.fromEntries(
	Object.keys(consumptionMeasures(table("event", "zero"))).map((key) => [key, 0]),
);

describe("Media analytics recipes", () => {
	it("reads one summary document and omits previous-period queries without a comparison", () => {
		expect(Object.keys(mediaAnalyticsSummaryRecipe(input).document.queries).sort()).toEqual([
			"currentActiveDays",
			"currentReviews",
			"currentTypes",
			"previousActiveDays",
			"previousReviews",
			"previousTypes",
			"processing",
			"undated",
		]);
		expect(Object.keys(mediaAnalyticsSummaryRecipe(allTime).document.queries).sort()).toEqual([
			"currentActiveDays",
			"currentReviews",
			"currentTypes",
			"processing",
			"undated",
		]);
		for (const value of [input, allTime]) {
			expect(validate(mediaAnalyticsSummaryRecipe(value).document)).toBeNull();
		}
	});
	it.each([
		{ failed: 0, pending: 0, processing: "ready" },
		{ failed: 0, pending: 2, processing: "pending" },
		{ failed: 1, pending: 2, processing: "failed" },
	])("derives processing from stream status: %s", ({ failed, pending, processing }) => {
		const result = Result.getOrThrow(
			mediaAnalyticsSummaryRecipe(allTime).decode({
				data: {
					currentTypes: aggregate([]),
					currentReviews: aggregate([]),
					undated: aggregate([{ count: 3 }]),
					processing: aggregate([{ failed, pending }]),
					currentActiveDays: aggregate([{ activeDays: 0 }]),
				},
			}),
		);
		expect(result).toEqual({
			processing,
			unknownDate: 3,
			previous: null,
			current: { types: [], reviews: [], activeDays: 0 },
		});
	});
	it("applies each period before aggregation and reads processing from streams", () => {
		const { queries } = mediaAnalyticsSummaryRecipe(input).document;
		expect(JSON.stringify(queries["currentTypes"]?.where)).toContain("2026-09-30T04:00:00.000Z");
		expect(JSON.stringify(queries["currentTypes"]?.where)).toContain("2026-09-29T00:00:00.000Z");
		expect(JSON.stringify(queries["currentTypes"]?.where)).toContain("2026-10-31T00:00:00.000Z");
		expect(JSON.stringify(queries["previousTypes"]?.where)).toContain("2026-08-31T04:00:00.000Z");
		expect(JSON.stringify(queries["previousReviews"]?.where)).toContain("2026-08-31T04:00:00.000Z");
		for (const name of ["currentTypes", "currentReviews", "currentActiveDays"]) {
			expect(JSON.stringify(queries[name])).not.toContain("projectionStatus");
		}
		expect(queries["processing"]?.from.table).toBe("eventStream");
		expect(JSON.stringify(queries["undated"])).not.toContain("projection");
		expect(queries["currentReviews"]?.output).toMatchObject({
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
	it("groups trends by one local bucket per row and resolves the compared period", () => {
		const recipe = mediaAnalyticsTrendRecipe({ ...input, mediaType: "book" });
		const text = JSON.stringify(recipe.document.queries["current"]);
		expect(text).toContain("book");
		expect(text).toContain("dateBucket");
		expect(text).not.toContain("mediaType");
		expect(validate(recipe.document)).toBeNull();
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					previous: aggregate([]),
					current: aggregate([{ ...zeros, pagesKnown: 1, at: "2026-10-01", pagesRecorded: 4 }]),
				},
			}),
		);
		expect(result.grouping).toBe("day");
		expect(result.current).toMatchObject({
			period: { endDate: "2026-10-29", startDate: "2026-09-30" },
			items: [{ pagesKnown: 1, at: "2026-10-01", pagesRecorded: 4 }],
		});
		expect(result.previous).toMatchObject({
			items: [],
			period: { endDate: "2026-09-29", startDate: "2026-08-31" },
		});
		expect(Object.keys(mediaAnalyticsTrendRecipe(allTime).document.queries)).toEqual(["current"]);
	});
	it("groups hours by instant evidence only", () => {
		const recipe = mediaAnalyticsHoursRecipe(input);
		const query = recipe.document.queries["hourly"];
		expect(JSON.stringify(query?.where)).toContain('"instant"');
		expect(validate(recipe.document)).toBeNull();
		expect(
			Result.getOrThrow(recipe.decode({ data: { hourly: aggregate([{ ...zeros, hour: 7 }]) } })),
		).toEqual([{ ...zeros, hour: 7 }]);
	});
	it("ranks titles by one grouped aggregate over period contributions with cursor pages", () => {
		const recipe = mediaAnalyticsRankingRecipe({
			...input,
			mediaType: "show-episode",
			after: "opaque-ranking-cursor",
		});
		const query = recipe.document.queries["ranking"];
		expect(validate(recipe.document)).toBeNull();
		expect(query?.from).toEqual(table("event", "analyticsRankEvent"));
		expect(JSON.stringify(query?.where)).toContain("2026-09-29T00:00:00.000Z");
		expect(query?.output).toMatchObject({
			limit: 100,
			type: "aggregate",
			after: "opaque-ranking-cursor",
			orderBy: [
				{ direction: "desc", key: "activeObservations" },
				{ key: "entityId", direction: "asc" },
			],
		});
		const item = {
			label: "Show",
			name: "Parent",
			mediaType: "show",
			entityId: "parent",
			titleCompletions: 1,
			activeObservations: 0,
			episodeCompletions: 0,
		};
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					ranking: {
						items: [item],
						type: "aggregate",
						pageInfo: { limit: 100, hasMore: true, nextCursor: "next-opaque" },
					},
				},
			}),
		);
		expect(result.items[0]).toMatchObject({ label: "Show", activeObservations: 0 });
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
		expect(validate(recipe.document)).toBeNull();
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
		for (const value of ["owned-title", "eventSchemaPluginId", "item-complete", "localHour"]) {
			expect(text).toContain(value);
		}
		for (const value of ["list-state", '"review"']) {
			expect(text).not.toContain(value);
		}
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					records: rows([
						{
							id: "item",
							name: "Anime",
							label: "Anime",
							orderKey: "item",
							entityId: "title",
							mediaType: "anime",
							eventType: "item-complete",
							occurredAt: "2026-10-10T00:00:00Z",
							orderCreatedAt: "2026-10-10T00:00:00Z",
							facts: { consumedItem: { position: 12, unit: "episodes" } },
							contribution: {
								titleCompletions: 0,
								episodeCompletions: 0,
								activeObservation: true,
								attribution: { kind: "date", value: "2026-10-10" },
								episodes: { recorded: 1, estimated: 0, missing: false, supersededEstimate: false },
							},
						},
					]),
				},
			}),
		);
		expect(result.items[0]?.facts.consumedItem?.position).toBe(12);
		expect(result.items[0]?.contribution.episodes?.recorded).toBe(1);
	});
});
