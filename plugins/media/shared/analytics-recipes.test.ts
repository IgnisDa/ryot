import { describe, expect, test } from "bun:test";

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
import { type ReportingSelection, TimeZone } from "@ryot-app/plugin-kit/schema";
import { reportingArguments } from "@ryot-app/ryotql-recipes/reporting-parameters";
import { bindRecipe, recipeResponse } from "@ryot-app/ryotql-recipes/test-utils";
import { arrayContaining, objectContaining } from "@ryot-app/testing/matchers";
import { it } from "@voila.dev/effect-bun-test";

import { reportingSelectionResponse } from "../tests/client/analytics-fixture";
import {
	consumptionMeasures,
	mediaAnalyticsHoursRecipe,
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsRecordsRecipe,
	mediaAnalyticsSummaryRecipe,
	mediaAnalyticsTrendRecipe,
} from "./analytics-recipes";
import { consumptionActiveDay, consumptionValue } from "./consumption-recipes";

const timeZone = TimeZone.make("America/New_York");
const selection: ReportingSelection = {
	grouping: "day",
	comparison: "previous-period",
	range: { days: 30, kind: "rolling" },
};
const input = { selection, reference: { kind: "self" } } as const;
const aggregate = (items: readonly unknown[]) => ({
	items,
	type: "aggregate",
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});
const rows = (items: readonly unknown[], nextCursor: null | string = null) => ({
	items,
	type: "rows",
	pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
});
const validate = (document: Parameters<typeof validateRyotQLDocument>[0]) =>
	validateRyotQLDocument(document, { type: "user", audience: "plugin", accessClass: "standard" })
		.error;
const allTime = { ...input, selection: { ...selection, range: { kind: "all-time" as const } } };
const zeros = Object.fromEntries(
	Object.keys(consumptionMeasures(table("event", "zero"))).map((key) => [key, 0]),
);

describe("Media analytics recipes", () => {
	it("reads one summary document and keeps comparison queries static across reporting selections", () => {
		expect(
			Object.keys(
				bindRecipe(
					mediaAnalyticsSummaryRecipe({ reference: input.reference }),
					{ ...reportingArguments(selection) },
					{ now: new Date("2026-10-29T12:00:00Z"), reportingTimeZone: "America/New_York" },
				).document.queries,
			).sort(),
		).toEqual([
			"currentActiveDays",
			"currentReviews",
			"currentTypes",
			"previousActiveDays",
			"previousReviews",
			"previousTypes",
			"processing",
			"selection",
			"undated",
		]);
		expect(
			Object.keys(
				bindRecipe(
					mediaAnalyticsSummaryRecipe({ reference: allTime.reference }),
					{ ...reportingArguments(allTime.selection) },
					{ now: new Date("2026-10-29T12:00:00Z"), reportingTimeZone: "America/New_York" },
				).document.queries,
			).sort(),
		).toEqual([
			"currentActiveDays",
			"currentReviews",
			"currentTypes",
			"previousActiveDays",
			"previousReviews",
			"previousTypes",
			"processing",
			"selection",
			"undated",
		]);
		for (const value of [input, allTime]) {
			expect(
				validate(
					bindRecipe(
						mediaAnalyticsSummaryRecipe({ reference: value.reference }),
						{ ...reportingArguments(value.selection) },
						{ now: new Date("2026-10-29T12:00:00Z"), reportingTimeZone: "America/New_York" },
					).document,
				),
			).toBeNull();
		}
	});
	test.each([
		{ failed: 0, pending: 0, processing: "ready" },
		{ failed: 0, pending: 2, processing: "pending" },
		{ failed: 1, pending: 2, processing: "failed" },
	])("derives processing from stream status: %s", ({ failed, pending, processing }) => {
		const result = Result.getOrThrow(
			bindRecipe(
				mediaAnalyticsSummaryRecipe({ reference: allTime.reference }),
				{ ...reportingArguments(allTime.selection) },
				{ now: new Date("2026-10-29T12:00:00Z"), reportingTimeZone: "America/New_York" },
			).decode({
				data: {
					currentTypes: aggregate([]),
					previousTypes: aggregate([]),
					currentReviews: aggregate([]),
					previousReviews: aggregate([]),
					undated: aggregate([{ count: 3 }]),
					processing: aggregate([{ failed, pending }]),
					currentActiveDays: aggregate([{ activeDays: 0 }]),
					previousActiveDays: aggregate([{ activeDays: 0 }]),
					selection: reportingSelectionResponse(reportingArguments(allTime.selection)),
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
	test.each([false, true])("preserves decoded previous-period totals (empty: %s)", (empty) => {
		const recipe = mediaAnalyticsSummaryRecipe({ reference: input.reference });
		const types = empty
			? []
			: [
					{
						...zeros,
						label: "Book",
						activeDays: 2,
						mediaType: "book",
						distinctTitles: 1,
						pagesRecorded: 42,
					},
				];
		const reviews = empty
			? []
			: [{ rated: 1, reviews: 1, label: "Book", mediaType: "book", averageRating: 80 }];
		const previous = { types, reviews, activeDays: empty ? 0 : 2 };
		const report = Result.getOrThrow(
			recipe.decode(
				recipeResponse(recipe, {
					currentTypes: aggregate([]),
					currentReviews: aggregate([]),
					previousTypes: aggregate(types),
					undated: aggregate([{ count: 0 }]),
					previousReviews: aggregate(reviews),
					currentActiveDays: aggregate([{ activeDays: 0 }]),
					processing: aggregate([{ failed: 0, pending: 0 }]),
					selection: reportingSelectionResponse(reportingArguments(selection)),
					previousActiveDays: aggregate([{ activeDays: previous.activeDays }]),
				}),
			),
		);
		expect(report.previous).toEqual<unknown>(previous);
	});
	it("applies each period before aggregation and reads processing from event projections", () => {
		const { queries } = bindRecipe(
			mediaAnalyticsSummaryRecipe({ reference: input.reference }),
			{ ...reportingArguments(selection) },
			{ now: new Date("2026-10-29T12:00:00Z"), reportingTimeZone: "America/New_York" },
		).document;
		expect(JSON.stringify(queries["currentTypes"]?.where)).toContain("2026-10-29T12:00:00.000Z");
		expect(JSON.stringify(queries["currentTypes"]?.where)).toContain('"amount":-29');
		expect(JSON.stringify(queries["currentTypes"]?.where)).toContain('"amount":1');
		expect(JSON.stringify(queries["previousTypes"]?.where)).toContain('"amount":-59');
		expect(JSON.stringify(queries["previousReviews"]?.where)).toContain('"amount":-59');
		for (const name of ["currentTypes", "currentReviews", "currentActiveDays"]) {
			expect(JSON.stringify(queries[name])).not.toContain("projectionStatus");
		}
		expect(queries["processing"]?.from.table).toBe("event");
		expect(JSON.stringify(queries["undated"])).not.toContain("projection");
		expect(queries["currentReviews"]?.output).toEqual<unknown>(
			objectContaining({
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
			}),
		);
	});
	it("keeps date-only days and excludes unknown precision from the instant calendar conversion", () => {
		const event = table("event", "source");
		const kind = castText(consumptionValue(event, "attribution", "kind"));
		expect(consumptionActiveDay(event, timeZone)).toEqual(
			conditional(
				eq(kind, literal("date")),
				castText(consumptionValue(event, "attribution", "value")),
				conditional(
					eq(kind, literal("instant")),
					localDate(castDate(consumptionValue(event, "attribution", "value")), { timeZone }),
					literal(null),
				),
			),
		);
	});
	it("groups trends by one local bucket per row and resolves the compared period", () => {
		const recipe = bindRecipe(
			mediaAnalyticsTrendRecipe({ reference: { ...input, mediaType: "book" }.reference }),
			{ ...reportingArguments(selection), mediaType: "book" },
			{ now: new Date("2026-10-29T12:00:00Z"), reportingTimeZone: "America/New_York" },
		);
		const text = JSON.stringify(recipe.document.queries["current"]);
		expect(text).toContain("book");
		expect(text).toContain("dateBucket");
		expect(text).not.toContain("mediaType");
		expect(validate(recipe.document)).toBeNull();
		const result = Result.getOrThrow(
			recipe.decode(
				recipeResponse(recipe, {
					previous: aggregate([]),
					selection: reportingSelectionResponse(reportingArguments(selection)),
					current: aggregate([{ ...zeros, pagesKnown: 1, at: "2026-10-01", pagesRecorded: 4 }]),
				}),
			),
		);
		expect(JSON.stringify(recipe.document.queries["current"])).toContain('"unit":"day"');
		expect(result.current).toMatchObject({
			items: [{ pagesKnown: 1, at: "2026-10-01", pagesRecorded: 4 }],
		});
		expect(result.previous).toMatchObject({ items: [] });
		expect(
			Object.keys(
				bindRecipe(
					mediaAnalyticsTrendRecipe({ reference: allTime.reference }),
					{ ...reportingArguments(allTime.selection) },
					{ now: new Date("2026-10-29T12:00:00Z"), reportingTimeZone: "America/New_York" },
				).document.queries,
			),
		).toEqual(["current", "selection", "previous"]);
	});
	it("groups hours by instant evidence only", () => {
		const recipe = bindRecipe(
			mediaAnalyticsHoursRecipe({ reference: input.reference }),
			{ ...reportingArguments(selection) },
			{ now: new Date("2026-10-29T12:00:00Z"), reportingTimeZone: "America/New_York" },
		);
		const query = recipe.document.queries["hourly"];
		expect(JSON.stringify(query?.where)).toContain('"instant"');
		expect(validate(recipe.document)).toBeNull();
		expect(
			Result.getOrThrow(
				recipe.decode(recipeResponse(recipe, { hourly: aggregate([{ ...zeros, hour: 7 }]) })),
			),
		).toEqual<unknown>([{ ...zeros, hour: 7 }]);
	});
	it("ranks titles by one grouped aggregate over period contributions with cursor pages", () => {
		const recipe = bindRecipe(
			mediaAnalyticsRankingRecipe({
				reference: { ...input, mediaType: "show-episode", after: "opaque-ranking-cursor" }
					.reference,
			}),
			{
				...reportingArguments(selection),
				mediaType: "show-episode",
				after: "opaque-ranking-cursor",
			},
			{ now: new Date("2026-10-29T12:00:00Z"), reportingTimeZone: "America/New_York" },
		);
		const query = recipe.document.queries["ranking"];
		expect(validate(recipe.document)).toBeNull();
		expect(query?.from).toEqual(table("event", "analyticsRankEvent"));
		expect(JSON.stringify(query?.where)).toContain('"amount":-29');
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
			recipe.decode(
				recipeResponse(recipe, {
					ranking: {
						items: [item],
						type: "aggregate",
						pageInfo: { limit: 100, hasMore: true, nextCursor: "next-opaque" },
					},
				}),
			),
		);
		expect(result.items[0]).toMatchObject({ label: "Show", activeObservations: 0 });
		expect(result.pageInfo.nextCursor).toBe("next-opaque");
	});
	it("keeps source facts and canonical contributions separate in logical-order event cursor rows", () => {
		const recipe = bindRecipe(
			mediaAnalyticsRecordsRecipe({
				reference: {
					...input,
					hour: 1,
					activeOnly: true,
					mediaType: "anime",
					entityId: "owned-title",
					after: "opaque-source-cursor",
				}.reference,
			}),
			{
				...reportingArguments(selection),
				hour: 1,
				activeOnly: true,
				mediaType: "anime",
				entityId: "owned-title",
				after: "opaque-source-cursor",
			},
			{ now: new Date("2026-10-29T12:00:00Z"), reportingTimeZone: "America/New_York" },
		);
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
			recipe.decode(
				recipeResponse(recipe, {
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
							facts: { position: { position: 12, unit: "episodes" } },
							contribution: {
								titleCompletions: 0,
								episodeCompletions: 0,
								activeObservation: true,
								attribution: { kind: "date", value: "2026-10-10" },
								episodes: { recorded: 1, estimated: 0, missing: false, supersededEstimate: false },
							},
						},
					]),
				}),
			),
		);
		expect(result.items[0]?.facts.position?.position).toBe(12);
		expect(result.items[0]?.contribution.episodes?.recorded).toBe(1);
	});
});
