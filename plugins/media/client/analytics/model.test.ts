import { calendarPeriod } from "@ryot-app/plugin-client-sdk/plugin";
import { Result } from "@ryot-app/plugin-kit/effect";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { describe, expect, it } from "vitest";

import { mediaAnalyticsStatsRecipe } from "../../shared/analytics-recipes";
import { mediaConsumptionReportRecipe } from "../../shared/consumption-recipes";
import {
	analyticsCalendarInput,
	analyticsWindow,
	analyticsWindowInput,
	calendarReportingExecution,
	compareValues,
	comparisonWindow,
	consistencyModel,
	extraPreviousWindow,
	formatExactValue,
	hourlyModel,
	type MediaAnalyticsTrend,
	periodCaption,
	quantityValue,
	rankingModel,
	recordModel,
	reportingExecution,
	reviewModel,
	summaryModel,
	trendModel,
} from "./model";

const input = {
	reference: { kind: "self" },
	timeZone: TimeZone.make("America/New_York"),
	selection: {
		grouping: "day",
		comparison: "previous-period",
		range: { days: 30, kind: "rolling" },
	},
} as const;
const now = Date.parse("2026-10-29T12:00:00Z");
const totals = {
	pagesMissing: 1,
	minutesMissing: 0,
	volumesMissing: 0,
	minutesRecorded: 0,
	episodesMissing: 0,
	chaptersMissing: 0,
	volumesRecorded: 0,
	titleCompletions: 2,
	minutesEstimated: 0,
	episodesRecorded: 0,
	chaptersRecorded: 0,
	volumesEstimated: 0,
	episodesEstimated: 0,
	chaptersEstimated: 0,
	episodeCompletions: 0,
	activeObservations: 3,
	pagesRecorded: 70.125,
	pagesEstimated: 29.875,
};
const presence = {
	activeDays: 1,
	pagesKnown: 2,
	minutesKnown: 0,
	volumesKnown: 0,
	episodesKnown: 0,
	chaptersKnown: 0,
	distinctTitles: 1,
	pagesSuperseded: 0,
	minutesSuperseded: 0,
	volumesSuperseded: 0,
	episodesSuperseded: 0,
	chaptersSuperseded: 0,
};
const aggregate = (items: readonly unknown[], hasMore = false) => ({
	items,
	type: "aggregate",
	pageInfo: { hasMore, limit: 100 },
});
const report = (pending = 0, failed = 0, hasMore = false) =>
	Result.getOrThrow(
		mediaConsumptionReportRecipe({ ...input, now }).decode({
			data: {
				hourly: aggregate([]),
				trends: aggregate([]),
				reviews: aggregate([]),
				previous: aggregate([]),
				rankings: aggregate([]),
				current: aggregate([{ ...totals, mediaType: "book" }], hasMore),
				activeWork: {
					type: "rows",
					items: [],
					pageInfo: { hasMore: false, limit: 1, nextCursor: null },
				},
				coverage: aggregate([{ failed, pending, unknownDate: 2, mediaType: "book" }]),
			},
		}),
	);
const stats = () =>
	Result.getOrThrow(
		mediaAnalyticsStatsRecipe({
			...analyticsCalendarInput(input, reportingExecution(input, now)),
			now,
		}).decode({
			data: {
				previousTypes: aggregate([]),
				previousReviewTypes: aggregate([]),
				currentGlobal: aggregate([presence]),
				currentReviews: aggregate([{ rated: 3, reviews: 3, averageRating: 40 }]),
				previousReviews: aggregate([{ rated: 0, reviews: 0, averageRating: null }]),
				previousGlobal: aggregate([{ ...presence, activeDays: 0, distinctTitles: 0 }]),
				currentTypes: aggregate([
					{ ...presence, mediaType: "book" },
					{ ...presence, mediaType: "movie" },
				]),
				currentReviewTypes: aggregate([
					{ rated: 1, reviews: 1, averageRating: 0, mediaType: "person" },
					{ rated: 2, reviews: 2, averageRating: 60, mediaType: "show-episode" },
				]),
			},
		}),
	);
const trend = (
	startDate = "2026-10-01",
	endDate = "2026-10-02",
	hasMore = false,
): MediaAnalyticsTrend => ({
	grouping: "day",
	pageInfo: { hasMore, limit: 1000 },
	period: calendarPeriod(startDate, endDate, input.timeZone),
	items: [
		{ ...totals, ...presence, at: startDate, mediaType: "book", precision: "date" },
		{
			...totals,
			...presence,
			at: startDate,
			pagesKnown: 1,
			pagesMissing: 0,
			mediaType: "book",
			pagesEstimated: 0,
			titleCompletions: 1,
			pagesRecorded: 0.25,
			precision: "instant",
		},
	],
});

describe("Media analytics presentation model", () => {
	it("keeps supplemental calendar inputs equal across same-day report clocks and keeps all-time summaries timeless", () => {
		const morning = reportingExecution(input, Date.parse("2026-11-01T05:30:00.001Z"));
		const evening = reportingExecution(input, Date.parse("2026-11-02T04:59:59.999Z"));
		expect(morning.now).not.toBe(evening.now);
		expect(analyticsCalendarInput(input, morning)).toEqual(analyticsCalendarInput(input, evening));
		expect(analyticsWindowInput(input, morning)).toEqual(analyticsWindowInput(input, evening));
		const nextDay = reportingExecution(input, Date.parse("2026-11-02T05:00:00Z"));
		expect(analyticsCalendarInput(input, nextDay)).not.toEqual(
			analyticsCalendarInput(input, evening),
		);
		const allTime = {
			...input,
			selection: { ...input.selection, range: { kind: "all-time" as const } },
		};
		const first = reportingExecution(allTime, morning.now);
		const second = reportingExecution(allTime, nextDay.now);
		expect(analyticsCalendarInput(allTime, first)).toEqual(analyticsCalendarInput(allTime, second));
		expect(analyticsCalendarInput(allTime, first)).not.toHaveProperty("now");
		expect(analyticsCalendarInput(allTime, first)).not.toHaveProperty("reporting");
		expect(analyticsCalendarInput(allTime, first)).not.toHaveProperty("anchorDate");
		expect(analyticsWindowInput(allTime, first).anchorDate).toBe("2026-11-01");
		expect(analyticsWindowInput(allTime, second).anchorDate).toBe("2026-11-02");
	});
	it("resolves explicit current and previous calendars with a fresh execution clock without changing month lengths or DST", () => {
		const selected = {
			...input,
			selection: { ...input.selection, range: { offset: 0, unit: "month", kind: "calendar" } },
		} as const;
		const parent = reportingExecution(selected, Date.parse("2026-03-15T12:00:00Z"));
		const stable = analyticsCalendarInput(selected, parent);
		const executedAt = Date.parse("2026-11-02T18:00:00Z");
		const fresh = calendarReportingExecution(stable, executedAt);
		expect(fresh.now).toBe(executedAt);
		expect(fresh.resolved).toEqual(parent.resolved);
		expect(fresh.resolved.current).toMatchObject({
			endAt: "2026-04-01T04:00:00.000Z",
			startAt: "2026-03-01T05:00:00.000Z",
		});
		expect(fresh.resolved.previous).toMatchObject({
			endDate: "2026-02-28",
			startDate: "2026-02-01",
		});
	});
	it("preserves exact fractions, known zero, missing-only, and absent/superseded quantity distinctions", () => {
		expect(formatExactValue(70.125, "pages")).toBe("70.125 pages");
		expect(formatExactValue(1 / 3, "minutes")).toBe("0.3333333333333333 minutes");
		expect(formatExactValue(null)).toBe("Unknown");
		expect(formatExactValue(-0)).toBe("0");
		const source = {
			...totals,
			...presence,
			at: "2026-10-01",
			mediaType: "book",
			precision: "date",
		} as const;
		expect(
			quantityValue(
				{ ...source, pagesRecorded: 0, pagesEstimated: 0 },
				{ ...source, pagesKnown: 1 },
				"pages",
			),
		).toMatchObject({ value: 0, known: 1, missing: 1, partial: true });
		expect(quantityValue(source, { ...source, pagesKnown: 0 }, "pages").value).toBeNull();
		expect(quantityValue(source, source, "minutes")).toMatchObject({
			known: 0,
			missing: 0,
			value: null,
		});
		expect(
			quantityValue(source, { ...source, pagesKnown: 0, pagesSuperseded: 1 }, "pages"),
		).toMatchObject({ value: null, superseded: 1 });
	});
	it.each([
		[1, 0, "pending"],
		[1, 1, "failed"],
	] as const)(
		"masks global consumption and rankings during repair but keeps reviews independent: %s/%s",
		(pending, failed, processing) => {
			const source = report(pending, failed);
			const data = stats();
			const model = summaryModel(source, data);
			expect(model.processing).toBe(processing);
			expect(model.current).toMatchObject({
				activeDays: null,
				distinctTitles: null,
				titleCompletions: null,
				episodeCompletions: null,
			});
			expect(model.current.types[0]?.quantities?.pages).toMatchObject({
				value: null,
				missing: null,
				recorded: null,
			});
			expect(model.reviews?.current.global).toEqual({ rated: 3, reviews: 3, averageRating: 40 });
			expect(
				rankingModel(
					[
						{
							name: "Book",
							entityId: "book",
							mediaType: "book",
							titleCompletions: 2,
							activeObservations: 4,
							episodeCompletions: 0,
						},
					],
					processing,
				)[0]?.activeObservations,
			).toBeNull();
			expect(
				trendModel(trend(), null, "pages", processing, input.timeZone).buckets[0]?.current.value,
			).toBeNull();
		},
	);
	it("uses authoritative global distinct/day counts and lower-bound category totals without changing source rows", () => {
		const source = report(0, 0, true);
		const row = source.current.items[0];
		const model = summaryModel(source, stats());
		expect(model.current).toMatchObject({
			activeDays: 1,
			partial: true,
			distinctTitles: 1,
			titleCompletions: 2,
		});
		expect(model.current.types[0]?.source).toBe(row);
		expect(model.current.types[0]?.quantities?.pages).toMatchObject({
			value: 100,
			missing: 1,
			partial: true,
			recorded: 70.125,
			estimated: 29.875,
		});
		expect(source.current.items[0]?.pagesRecorded).toBe(70.125);
		expect(model.current.quantities.pages).toMatchObject({
			value: 100,
			partial: true,
			recorded: 70.125,
			estimated: 29.875,
		});
		expect(model.current.unknownDate).toBe(2);
	});
	it("merges normalized date and instant rows only for presentation and keeps previous actual dates", () => {
		const current = trend();
		const previous = trend("2026-09-01", "2026-09-03");
		const model = trendModel(current, previous, "pages", "ready", input.timeZone);
		expect(model.buckets[0]?.current).toMatchObject({
			known: 3,
			missing: 1,
			value: 100.25,
			lowerBound: true,
			date: "2026-10-01",
		});
		expect(model.buckets[0]?.previous?.date).toBe("2026-09-01");
		expect(model.extraPrevious.map((bucket) => bucket.date)).toEqual(["2026-09-03"]);
		expect(model.buckets[1]?.current.value).toBeNull();
		expect(current.items).toHaveLength(2);
		expect(
			trendModel(current, null, "titleCompletions", "ready", input.timeZone).buckets.map(
				(bucket) => bucket.current.value,
			),
		).toEqual([3, 0]);
	});
	it("does not fill truncated chart groups with confident zero or combine units", () => {
		const model = trendModel(
			trend("2026-10-01", "2026-10-02", true),
			null,
			"titleCompletions",
			"ready",
			input.timeZone,
		);
		expect(model.partial).toBe(true);
		expect(model.buckets.map((bucket) => bucket.current.value)).toEqual([3, null]);
		expect(model.buckets[0]?.current.lowerBound).toBe(true);
		const source = trend().items[0];
		if (source === undefined) {
			throw new Error("Expected a trend fixture");
		}
		expect(
			hourlyModel(
				{ items: [{ ...source, hour: 1 }], pageInfo: { limit: 1000, hasMore: false } },
				"minutes",
				"ready",
			).hours[1]?.value,
		).toBeNull();
	});
	it("keeps daily consistency independent of selected monthly grouping and marks incomplete empty days unknown", () => {
		const period = calendarPeriod("2026-03-07", "2026-03-09", input.timeZone);
		const data = { period, hasMore: false, days: [{ events: 2, day: "2026-03-08" }] };
		expect(consistencyModel(data, "ready").days).toEqual([
			{ value: 0, date: "2026-03-07" },
			{ value: 2, date: "2026-03-08" },
			{ value: 0, date: "2026-03-09" },
		]);
		expect(consistencyModel({ ...data, hasMore: true }, "ready").days[0]?.value).toBeNull();
		expect(consistencyModel(data, "failed").days.every((day) => day.value === null)).toBe(true);
	});
	it("navigates bounded explicit day windows and bounded daily all-time history without coarsening", () => {
		const reporting = reportingExecution(
			{ ...input, selection: { ...input.selection, range: { kind: "all-time" } } },
			now,
		);
		const window = analyticsWindow(reporting, "trend");
		expect(window).toMatchObject({
			grouping: "day",
			nextCursor: null,
			previousCursor: "2026-09-27",
			period: { endDate: "2026-10-29", startDate: "2026-09-28" },
		});
		const earlier = analyticsWindow(reporting, "trend", window.previousCursor ?? undefined);
		expect(earlier.period).toMatchObject({ endDate: "2026-09-27", startDate: "2026-08-27" });
		expect(analyticsWindow(reporting, "trend", earlier.nextCursor ?? undefined).period).toEqual(
			window.period,
		);
		const daily = analyticsWindow(reporting, "daily");
		expect(Date.parse(daily.period.endDate) - Date.parse(daily.period.startDate)).toBe(
			399 * 86_400_000,
		);
		expect(daily.previousCursor).not.toBeNull();
	});
	it("aligns unequal calendar months ordinally and retains extra prior dates", () => {
		const reporting = reportingExecution(
			{
				...input,
				selection: {
					grouping: "day",
					comparison: "previous-period",
					range: { offset: -1, unit: "month", kind: "calendar" },
				},
			},
			Date.parse("2026-03-15T12:00:00Z"),
		);
		const window = analyticsWindow(reporting, "trend");
		expect(window.period).toMatchObject({ endDate: "2026-02-28", startDate: "2026-02-01" });
		const previous = comparisonWindow(reporting, window);
		expect(previous).toMatchObject({ endDate: "2026-01-31", startDate: "2026-01-01" });
		expect(extraPreviousWindow(reporting, window, previous)).toBeNull();
		expect(periodCaption(previous)).toBe("2026-01-01 – 2026-01-31");
	});
	it("splits the extra prior leap-year day instead of exceeding a 32-bucket recipe", () => {
		const reporting = reportingExecution(
			{
				...input,
				selection: {
					grouping: "day",
					comparison: "previous-period",
					range: { offset: -1, unit: "year", kind: "calendar" },
				},
			},
			Date.parse("2026-01-15T12:00:00Z"),
		);
		const window = analyticsWindow(reporting, "trend");
		const previous = comparisonWindow(reporting, window);
		expect(previous).toMatchObject({ endDate: "2024-12-30", startDate: "2024-11-29" });
		expect(extraPreviousWindow(reporting, window, previous)).toMatchObject({
			endDate: "2024-12-31",
			startDate: "2024-12-31",
		});
	});
	it("keeps zero-rated people and child reviews honest and takes the overall average from source aggregates", () => {
		const model = reviewModel(stats().reviews);
		expect(model.current.global.averageRating).toBe(40);
		expect(model.current.categories).toMatchObject([
			{ rated: 1, label: "People", kind: "creator", averageRating: 0 },
			{ rated: 2, kind: "child", averageRating: 60, label: "Show episodes" },
		]);
	});
	it("labels item position and raw partial progress separately from immutable canonical amounts", () => {
		const row = {
			id: "item",
			name: "Anime",
			orderKey: "item",
			entityId: "anime",
			mediaType: "anime",
			eventType: "item-complete",
			occurredAt: "2026-10-01T00:00:00Z",
			orderCreatedAt: "2026-10-01T00:00:00Z",
			facts: {
				timeSpent: 0,
				consumedItem: { position: 12, unit: "episodes" },
				sourceProgress: { percent: 50, position: 12, unit: "episodes" },
			},
			contribution: {
				titleCompletions: 0,
				episodeCompletions: 0,
				activeObservation: true,
				attribution: { kind: "unknown" },
				episodes: { recorded: 1, estimated: 0, missing: false, supersededEstimate: false },
			},
		} as const;
		const model = recordModel(row, "ready");
		expect(model.item).toBe("episodes position 12");
		expect(model.sourceProgress).toContain("not an allocated amount");
		expect(model.manualMinutes).toBe(0);
		expect(model.date).toBe("Unknown date");
		expect(model.contribution).toBe(row.contribution);
		expect(recordModel(row, "pending").contribution).toBeNull();
	});
	it("does not calculate infinite changes or percentages from unknown/lower-bound values", () => {
		expect(compareValues(2, 0)).toEqual({ absolute: 2, percent: null, kind: "new-activity" });
		expect(compareValues(0, 0)).toEqual({ percent: 0, absolute: 0, kind: "change" });
		expect(compareValues(null, 2).kind).toBe("unknown");
		expect(compareValues(4, 2, true).kind).toBe("unknown");
	});
});
