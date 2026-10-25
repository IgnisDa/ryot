import { afterEach, expect, it } from "@effect/vitest";
import type { ReportingSelection } from "@ryot-app/plugin-client-sdk/plugin";
import { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { COLLECTION_REVIEW_BUCKET_LIMIT } from "@ryot-app/ryotql-recipes/collection-analytics";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { Effect } from "effect";

import { CollectionAnalytics } from "./collection-analytics";

afterEach(disposePluginBridges);

const defaultSelection: ReportingSelection = {
	grouping: "day",
	comparison: "previous-period",
	range: { kind: "custom", endDate: "2026-03-08", startDate: "2026-03-08" },
};

const Fixture = ({ selection }: { readonly selection: ReportingSelection }) => (
	<CollectionAnalytics selection={selection} timeZone={TimeZone.make("America/New_York")} />
);

const mountCollections = (selection = defaultSelection) =>
	mountPluginPage(() => <Fixture selection={selection} />, {
		location: routeLocation("/v/k/analytics"),
		page: savedViewPageContext({
			settings: {},
			savedViewId: "analytics",
			rendererName: "Analytics",
			dataSources: { queries: {} },
		}),
	});

const selectionFor = (
	grouping: ReportingSelection["grouping"],
	startDate: string,
	endDate: string,
): ReportingSelection => ({
	grouping,
	comparison: "none",
	range: { endDate, startDate, kind: "custom" },
});

const request = (page: ReturnType<typeof mountPluginPage>, name: string, index = 0) =>
	Effect.gen(function* () {
		yield* Effect.promise(() =>
			waitFor(() => expect(page.queryRequests(name).length).toBeGreaterThan(index)),
		);
		const found = page.queryRequests(name)[index];
		if (!found) {
			return yield* Effect.die(new Error(`Missing ${name} request`));
		}
		return found;
	});

const replySummary = (
	page: ReturnType<typeof mountPluginPage>,
	summary: { readonly requestId: string },
	items: ReadonlyArray<{ readonly at: string; readonly count: number }>,
	pageInfo: null | { readonly limit: number; readonly hasMore: boolean } = {
		limit: 100,
		hasMore: false,
	},
	currentTotal = items.reduce((total, row) => total + row.count, 0),
) =>
	page.replyQuery(summary.requestId, {
		outcome: "success",
		response: {
			data: {
				previous: { type: "aggregate", items: [{ count: 0 }] },
				current: { type: "aggregate", items: [{ count: currentTotal }] },
				buckets: { items, ...(pageInfo === null ? {} : { pageInfo }), type: "aggregate" },
			},
		},
	});

const chartRows = () =>
	Effect.gen(function* () {
		yield* Effect.promise(() => screen.findByRole("img", { name: "Collection review trend" }));
		fireEvent.click(screen.getByText("View exact values"));
		const table = screen.getByRole("table", { name: "Collection review trend exact values" });
		return [...table.querySelectorAll("tbody tr")].map((row) => [
			row.querySelector("td")?.textContent ?? "",
			row.querySelector("td:last-child")?.textContent ?? "",
		]);
	});

const displayedDate = (period: string | undefined) => period?.split(" · ").at(-1) ?? "";

const dateLabel = (date: string) =>
	new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeZone: TimeZone.make("UTC"),
	}).format(new Date(`${date}T00:00:00.000Z`));

const loadChartRows = (
	selection: ReportingSelection,
	items: ReadonlyArray<{ readonly at: string; readonly count: number }>,
	pageInfo: null | { readonly limit: number; readonly hasMore: boolean } = {
		limit: 100,
		hasMore: false,
	},
	currentTotal?: number,
) =>
	Effect.gen(function* () {
		const page = mountCollections(selection);
		const summary = yield* request(page, "current");
		replySummary(page, summary, items, pageInfo, currentTotal);
		return yield* chartRows();
	});

it.effect(
	"shows actual periods and rating-only records, pages real cursors, and retains records on retry",
	() =>
		Effect.gen(function* () {
			const page = mountCollections();
			const summary = yield* request(page, "current");
			const records = yield* request(page, "reviews");
			replySummary(page, summary, [{ count: 2, at: "2026-03-08T05:00:00.000Z" }], {
				limit: 1,
				hasMore: true,
			});
			page.replyQuery(records.requestId, {
				outcome: "success",
				response: {
					data: {
						reviews: {
							type: "rows",
							pageInfo: { limit: 1, hasMore: true, nextCursor: "real-cursor" },
							items: [
								{
									rating: 0,
									id: "review-1",
									name: "Archive",
									entityId: "collection-1",
									occurredAt: "2026-03-08T05:00:00.000Z",
								},
							],
						},
					},
				},
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByText("Rating: 0/100")).toBeDefined()),
			);
			expect(screen.getByText("Current · 2026-03-08 – 2026-03-08")).toBeDefined();
			expect(screen.getByText("Previous · 2026-03-07 – 2026-03-07")).toBeDefined();
			expect(screen.getByText("0 reviews", { selector: "dd" })).toBeDefined();
			expect(screen.getByText(/Trend is truncated/)).toBeDefined();
			expect(screen.getByText(/Includes rating-only reviews/).textContent).toContain(
				TimeZone.make("America/New_York"),
			);
			fireEvent.click(screen.getByRole("button", { name: "Load more reviews" }));
			const next = yield* request(page, "reviews", 1);
			expect(next.document.queries.reviews?.output).toMatchObject({
				pagination: { after: "real-cursor" },
			});
			expect(next.document.queries.reviews?.where).toEqual(records.document.queries.reviews?.where);
			page.replyQuery(next.requestId, { outcome: "failure", reason: "query-failed" });
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByRole("button", { name: "Retry records" })).toBeDefined()),
			);
			expect(screen.getByRole("link", { name: "Archive" })).toBeDefined();
			fireEvent.click(screen.getByRole("button", { name: "Retry records" }));
			const retry = yield* request(page, "reviews", 2);
			expect(retry.document.queries.reviews?.output).toMatchObject({
				pagination: { after: "real-cursor" },
			});
			page.replyQuery(retry.requestId, {
				outcome: "success",
				response: {
					data: {
						reviews: {
							type: "rows",
							pageInfo: { limit: 1, hasMore: false, nextCursor: null },
							items: [
								{
									rating: null,
									id: "review-2",
									name: "Notebook",
									entityId: "collection-2",
									occurredAt: "2026-03-08T05:00:00.000Z",
								},
							],
						},
					},
				},
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByRole("link", { name: "Notebook" })).toBeDefined()),
			);
			expect(screen.getByRole("link", { name: "Archive" })).toBeDefined();
			expect(screen.queryByRole("button", { name: "Load more reviews" })).toBeNull();
			expect(page.queryRequests("current")).toHaveLength(1);
		}),
);

it.effect("fills finite day ranges with calendar buckets between sparse review days", () =>
	Effect.gen(function* () {
		const rows = yield* loadChartRows(selectionFor("day", "2026-03-01", "2026-03-07"), [
			{ count: 2, at: "2026-03-01T05:00:00.000Z" },
			{ count: 3, at: "2026-03-05T05:00:00.000Z" },
		]);
		const dates = [
			"2026-03-01",
			"2026-03-02",
			"2026-03-03",
			"2026-03-04",
			"2026-03-05",
			"2026-03-06",
			"2026-03-07",
		];
		expect(rows).toHaveLength(7);
		expect(
			rows.map(([period, value], index) => [
				period?.endsWith(dateLabel(dates[index] ?? "")) ?? false,
				value,
			]),
		).toEqual([
			[true, "2 reviews"],
			[true, "0 reviews"],
			[true, "0 reviews"],
			[true, "0 reviews"],
			[true, "3 reviews"],
			[true, "0 reviews"],
			[true, "0 reviews"],
		]);
	}),
);

it.effect("shows known empty days as zero across a finite range", () =>
	Effect.gen(function* () {
		const rows = yield* loadChartRows(selectionFor("day", "2026-03-01", "2026-03-07"), []);
		expect(rows).toHaveLength(7);
		expect(rows.map(([, value]) => value)).toEqual(Array(7).fill("0 reviews"));
	}),
);

it.effect("requests trend buckets with the recipe-owned group limit", () =>
	Effect.gen(function* () {
		const summary = yield* request(mountCollections(), "current");
		expect(summary.document.queries.buckets?.output).toMatchObject({
			limit: COLLECTION_REVIEW_BUCKET_LIMIT,
		});
	}),
);

it.effect("keeps gaps unknown when the aggregate query is truncated", () =>
	Effect.gen(function* () {
		const rows = yield* loadChartRows(
			selectionFor("day", "2026-03-01", "2026-03-07"),
			[
				{ count: 2, at: "2026-03-01T05:00:00.000Z" },
				{ count: 3, at: "2026-03-05T05:00:00.000Z" },
			],
			{ limit: 100, hasMore: true },
			42,
		);
		expect(rows).toHaveLength(7);
		expect(rows.map(([, value]) => value)).toEqual([
			"2 reviews",
			"Not recorded",
			"Not recorded",
			"Not recorded",
			"3 reviews",
			"Not recorded",
			"Not recorded",
		]);
		expect(screen.getByText(/Trend is truncated/)).toBeDefined();
		expect(screen.getByText("42 reviews", { selector: "dd" })).toBeDefined();
	}),
);

it.effect("does not treat missing aggregate page info as a complete result", () =>
	Effect.gen(function* () {
		const rows = yield* loadChartRows(
			selectionFor("day", "2026-03-01", "2026-03-07"),
			[{ count: 2, at: "2026-03-01T05:00:00.000Z" }],
			null,
		);
		expect(rows).toHaveLength(7);
		expect(rows.map(([, value]) => value)).toEqual([
			"2 reviews",
			"Not recorded",
			"Not recorded",
			"Not recorded",
			"Not recorded",
			"Not recorded",
			"Not recorded",
		]);
		expect(screen.queryByText(/Trend is truncated/)).toBeNull();
	}),
);

it.effect("uses local calendar dates across a 23-hour New York day", () =>
	Effect.gen(function* () {
		expect(Date.parse("2026-03-09T04:00:00.000Z") - Date.parse("2026-03-08T05:00:00.000Z")).toBe(
			23 * 60 * 60 * 1000,
		);
		const springRows = yield* loadChartRows(selectionFor("day", "2026-03-07", "2026-03-09"), [
			{ count: 1, at: "2026-03-08T05:00:00.000Z" },
			{ count: 1, at: "2026-03-09T04:00:00.000Z" },
		]);
		expect(springRows.map(([period]) => displayedDate(period))).toEqual([
			dateLabel("2026-03-07"),
			dateLabel("2026-03-08"),
			dateLabel("2026-03-09"),
		]);
	}),
);

it.effect("uses local calendar dates across a 25-hour New York day", () =>
	Effect.gen(function* () {
		expect(Date.parse("2026-11-02T05:00:00.000Z") - Date.parse("2026-11-01T04:00:00.000Z")).toBe(
			25 * 60 * 60 * 1000,
		);
		const rows = yield* loadChartRows(selectionFor("day", "2026-10-31", "2026-11-02"), [
			{ count: 1, at: "2026-11-01T04:00:00.000Z" },
			{ count: 1, at: "2026-11-02T05:00:00.000Z" },
		]);
		expect(rows.map(([period]) => displayedDate(period))).toEqual([
			dateLabel("2026-10-31"),
			dateLabel("2026-11-01"),
			dateLabel("2026-11-02"),
		]);
	}),
);

it.effect("includes leap day in a finite daily calendar", () =>
	Effect.gen(function* () {
		const rows = yield* loadChartRows(selectionFor("day", "2024-02-28", "2024-03-01"), [
			{ count: 4, at: "2024-02-29T05:00:00.000Z" },
		]);
		expect(rows).toHaveLength(3);
		expect(rows.map(([period]) => displayedDate(period))).toEqual([
			dateLabel("2024-02-28"),
			dateLabel("2024-02-29"),
			dateLabel("2024-03-01"),
		]);
		expect(rows[1]?.[1]).toBe("4 reviews");
	}),
);

it.effect("starts partial weeks at Monday calendar boundaries", () =>
	Effect.gen(function* () {
		const rows = yield* loadChartRows(selectionFor("week", "2026-03-04", "2026-03-10"), [
			{ count: 1, at: "2026-03-04T05:00:00.000Z" },
		]);
		expect(rows).toHaveLength(2);
		expect(rows.map(([period]) => displayedDate(period))).toEqual([
			dateLabel("2026-03-02"),
			dateLabel("2026-03-09"),
		]);
	}),
);

it.effect("starts partial months at calendar boundaries", () =>
	Effect.gen(function* () {
		const rows = yield* loadChartRows(selectionFor("month", "2026-03-15", "2026-04-02"), [
			{ count: 1, at: "2026-03-20T04:00:00.000Z" },
		]);
		expect(rows).toHaveLength(2);
		expect(rows.map(([period]) => displayedDate(period))).toEqual([
			dateLabel("2026-03-01"),
			dateLabel("2026-04-01"),
		]);
	}),
);

it.effect("starts partial years at calendar boundaries", () =>
	Effect.gen(function* () {
		const rows = yield* loadChartRows(selectionFor("year", "2024-06-15", "2025-03-01"), [
			{ count: 1, at: "2024-08-01T04:00:00.000Z" },
		]);
		expect(rows).toHaveLength(2);
		expect(rows.map(([period]) => displayedDate(period))).toEqual([
			dateLabel("2024-01-01"),
			dateLabel("2025-01-01"),
		]);
	}),
);

it.effect(
	"uses a bounded returned-bucket table when a finite calendar exceeds its query limit",
	() =>
		Effect.gen(function* () {
			const page = mountCollections(selectionFor("day", "2026-03-01", "2026-03-07"));
			const summary = yield* request(page, "current");
			replySummary(
				page,
				summary,
				[
					{ count: 2, at: "2026-03-01T05:00:00.000Z" },
					{ count: 3, at: "2026-03-05T05:00:00.000Z" },
				],
				{ limit: 6, hasMore: false },
			);
			const table = yield* Effect.promise(() =>
				screen.findByRole("table", { name: "Collection review trend returned buckets" }),
			);
			const rows = [...table.querySelectorAll("tbody tr")];
			expect(rows).toHaveLength(2);
			expect(
				rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent)),
			).toEqual([
				["2026-03-01", "2"],
				["2026-03-05", "3"],
			]);
			expect(screen.queryByRole("img", { name: "Collection review trend" })).toBeNull();
			expect(screen.getByText(/too many calendar buckets/)).toBeDefined();
			expect(screen.getByText(/Choose a shorter range or a coarser grouping/)).toBeDefined();
		}),
);

it.effect("keeps all-time review buckets sparse", () =>
	Effect.gen(function* () {
		const rows = yield* loadChartRows(
			{ grouping: "year", comparison: "none", range: { kind: "all-time" } },
			[
				{ count: 1, at: "2023-01-01T05:00:00.000Z" },
				{ count: 2, at: "2025-01-01T05:00:00.000Z" },
			],
		);
		expect(rows).toHaveLength(2);
		expect(rows.map(([, value]) => value)).toEqual(["1 reviews", "2 reviews"]);
	}),
);

it.effect("keeps record results usable when totals fail and retries only totals", () =>
	Effect.gen(function* () {
		const page = mountCollections();
		const summary = yield* request(page, "current");
		const records = yield* request(page, "reviews");
		page.replyQuery(summary.requestId, { outcome: "failure", reason: "query-failed" });
		page.replyQuery(records.requestId, {
			outcome: "success",
			response: {
				data: {
					reviews: {
						items: [],
						type: "rows",
						pageInfo: { limit: 100, hasMore: false, nextCursor: null },
					},
				},
			},
		});
		yield* Effect.promise(() =>
			waitFor(() =>
				expect(screen.getByText("No collection reviews in this period.")).toBeDefined(),
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry totals" }));
		yield* request(page, "current", 1);
		expect(page.queryRequests("reviews")).toHaveLength(1);
	}),
);
