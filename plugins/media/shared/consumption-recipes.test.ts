import { validateRyotQLDocument } from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { arrayContaining } from "@ryot-app/testing/matchers";
import { describe, expect, it } from "vitest";

import { mediaConsumptionBenchmarkCases } from "../benchmarks/consumption";
import { bookRecipes } from "./book-recipes";
import { consumptionMeasureUnits } from "./consumption-allocation";
import { mediaConsumptionReportRecipe } from "./consumption-recipes";
import { podcastRecipes } from "./podcast-recipes";
import { showRecipes } from "./show-recipes";

const rows = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 10, hasMore: false, nextCursor: null },
});

const aggregate = (items: readonly unknown[], limit = 100, hasMore = false) => ({
	items,
	type: "aggregate",
	pageInfo: { limit, hasMore },
});

const emptyReport = () => ({
	current: aggregate([]),
	reviews: aggregate([]),
	previous: aggregate([]),
	coverage: aggregate([]),
	rankings: aggregate([]),
	trends: aggregate([], 1000),
	hourly: aggregate([], 1000),
});

const zeroAmounts = Object.fromEntries(
	consumptionMeasureUnits.flatMap((unit) =>
		["Recorded", "Estimated", "Missing"].map((field) => [`${unit}${field}`, 0]),
	),
);

describe("canonical consumption reads", () => {
	it.each([
		{
			disabled: true,
			range: { kind: "all-time" } as const,
			comparison: "previous-period" as const,
		},
		{ disabled: true, comparison: "none" as const, range: { days: 30, kind: "rolling" } as const },
		{
			disabled: false,
			comparison: "previous-period" as const,
			range: { days: 30, kind: "rolling" } as const,
		},
	])(
		"disables the previous source scan only when comparison is absent: %s",
		({ range, disabled, comparison }) => {
			const recipe = mediaConsumptionReportRecipe({
				reference: { kind: "self" },
				timeZone: TimeZone.make("UTC"),
				now: Date.parse("2026-10-29T12:00:00Z"),
				selection: { range, comparison, grouping: "auto" },
			});
			const previous = recipe.document.queries["previous"];
			const guard = {
				operator: "eq",
				type: "comparison",
				left: { value: false, type: "literal" },
				right: { value: true, type: "literal" },
			};
			if (disabled) {
				expect(previous?.where).toMatchObject({
					type: "and",
					predicates: arrayContaining([guard]),
				});
			} else {
				expect(previous?.where).not.toMatchObject({
					type: "and",
					predicates: arrayContaining([guard]),
				});
			}
		},
	);
	it.each([
		{ failed: 0, processing: "pending" },
		{ failed: 1, processing: "failed" },
	])(
		"retains repair and undated coverage with no period quantities: %s",
		({ failed, processing }) => {
			const recipe = mediaConsumptionReportRecipe({
				reference: { kind: "self" },
				timeZone: TimeZone.make("UTC"),
				now: Date.parse("2026-10-29T12:00:00Z"),
				selection: {
					grouping: "auto",
					comparison: "previous-period",
					range: { days: 30, kind: "rolling" },
				},
			});
			const result = Result.getOrThrow(
				recipe.decode({
					data: {
						...emptyReport(),
						coverage: aggregate([{ failed, pending: 2, unknownDate: 3, mediaType: "book" }]),
					},
				}),
			);
			expect(result.processing).toBe(processing);
			expect(result.current.items).toEqual([
				{
					...zeroAmounts,
					failed,
					pending: 2,
					unknownDate: 3,
					mediaType: "book",
					titleCompletions: 0,
					episodeCompletions: 0,
					activeObservations: 0,
				},
			]);
			expect(result.previous).toEqual(result.current);
		},
	);
	it("combines period quantities with full-history coverage and exposes truncation", () => {
		const recipe = mediaConsumptionReportRecipe({
			reference: { kind: "self" },
			timeZone: TimeZone.make("UTC"),
			now: Date.parse("2026-10-29T12:00:00Z"),
			selection: {
				grouping: "auto",
				comparison: "previous-period",
				range: { days: 30, kind: "rolling" },
			},
		});
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					...emptyReport(),
					coverage: aggregate(
						[
							{ failed: 0, pending: 0, unknownDate: 4, mediaType: "book" },
							{ failed: 0, pending: 0, unknownDate: 0, mediaType: "movie" },
						],
						100,
						true,
					),
					current: aggregate([
						{
							...zeroAmounts,
							mediaType: "book",
							pagesRecorded: 70,
							pagesEstimated: 30,
							titleCompletions: 1,
							episodeCompletions: 0,
							activeObservations: 2,
						},
					]),
				},
			}),
		);
		expect(result.processing).toBe("ready");
		expect(result.current.items).toMatchObject([
			{
				failed: 0,
				pending: 0,
				unknownDate: 4,
				mediaType: "book",
				pagesRecorded: 70,
				pagesEstimated: 30,
				titleCompletions: 1,
				activeObservations: 2,
			},
			{ mediaType: "movie", minutesRecorded: 0, titleCompletions: 0 },
		]);
		expect(result.current.pageInfo.hasMore).toBe(true);
		expect(result.previous?.items).toMatchObject([
			{ unknownDate: 4, pagesRecorded: 0, mediaType: "book" },
			{ mediaType: "movie", minutesRecorded: 0 },
		]);
		expect(result.previous?.pageInfo.hasMore).toBe(true);
	});
	it("keeps episodic lifetime and coverage reads within production query limits", () => {
		for (const recipes of [showRecipes, podcastRecipes]) {
			const recipe = recipes.activityRecipe({
				entityId: "parent",
				coverageLimit: 100,
				watchDayLimit: 1000,
				parentEventLimit: 60,
				episodeEventLimit: 100,
				collectionEventLimit: 60,
				episodeProgressLimit: 100,
				reference: { kind: "self" },
				timeZone: TimeZone.make("America/New_York"),
			});
			expect(
				validateRyotQLDocument(recipe.document, {
					type: "user",
					audience: "plugin",
					accessClass: "standard",
				}).error,
			).toBeNull();
		}
	});
	it("accepts the coordinated benchmark documents under ordinary plugin query limits", () => {
		for (const recipe of Object.values(mediaConsumptionBenchmarkCases({ kind: "self" }))) {
			expect(
				validateRyotQLDocument(recipe.document, {
					type: "user",
					audience: "plugin",
					accessClass: "standard",
				}).error,
			).toBeNull();
		}
	});
	it("validates the all-time and calendar-aware report within query limits", () => {
		for (const range of [
			{ kind: "all-time" } as const,
			{ kind: "custom", endDate: "2026-03-08", startDate: "2026-03-08" } as const,
		]) {
			const recipe = mediaConsumptionReportRecipe({
				reference: { kind: "self" },
				now: Date.parse("2026-03-09T12:00:00Z"),
				timeZone: TimeZone.make("America/New_York"),
				selection: { range, grouping: "auto", comparison: "previous-period" },
			});
			expect(
				validateRyotQLDocument(recipe.document, {
					type: "user",
					audience: "plugin",
					accessClass: "standard",
				}).error,
			).toBeNull();
			const result = Result.getOrThrow(recipe.decode({ data: emptyReport() }));
			expect(result.processing).toBe("ready");
			if (range.kind === "custom") {
				expect(result.resolved.current).toMatchObject({
					endDate: "2026-03-08",
					startDate: "2026-03-08",
					endAt: "2026-03-09T04:00:00.000Z",
					startAt: "2026-03-08T05:00:00.000Z",
				});
			} else {
				expect(result.previous).toBeNull();
			}
		}
	});
	it("flat detail totals expose repair state alongside quantities", () => {
		const recipe = bookRecipes.activityRecipe({
			eventLimit: 10,
			entityId: "book",
			collectionEventLimit: 10,
			reference: { kind: "self" },
		});
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					events: rows([]),
					collectionEvents: rows([]),
					totals: rows([
						{
							completionCount: 1,
							consumedAmount: 40,
							unknownAmountCount: 1,
							consumptionFailedCount: 1,
							consumptionPendingCount: 2,
						},
					]),
				},
			}),
		);
		expect(result).toMatchObject({
			completionCount: 1,
			consumedAmount: 40,
			unknownAmountCount: 1,
			consumptionFailedCount: 1,
			consumptionPendingCount: 2,
		});
		expect(
			validateRyotQLDocument(recipe.document, {
				type: "user",
				audience: "plugin",
				accessClass: "standard",
			}).error,
		).toBeNull();
	});
});
