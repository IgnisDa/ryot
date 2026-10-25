import { afterEach, expect, it } from "@effect/vitest";
import {
	REPORTING_BUCKET_LIMIT,
	type ReportingSelection,
	TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
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
) =>
	page.replyQuery(summary.requestId, {
		outcome: "success",
		response: {
			data: {
				previous: { type: "aggregate", items: [{ count: 0 }] },
				buckets: {
					items,
					type: "aggregate",
					pageInfo: { limit: 366, hasMore: false, nextCursor: null },
				},
				current: {
					type: "aggregate",
					items: [{ count: items.reduce((total, row) => total + row.count, 0) }],
				},
			},
		},
	});

const chartRows = () =>
	Effect.gen(function* () {
		yield* Effect.promise(() => screen.findByRole("img", { name: "Collection review trend" }));
		fireEvent.click(screen.getByText("View exact values"));
		const table = yield* Effect.promise(() =>
			screen.findByRole("table", { name: "Collection review trend exact values" }),
		);
		return [...table.querySelectorAll("tbody tr")].map((row) => [
			row.querySelector("td")?.textContent ?? "",
			row.querySelector("td:last-child")?.textContent ?? "",
		]);
	});

const loadChartRows = (
	selection: ReportingSelection,
	items: ReadonlyArray<{ readonly at: string; readonly count: number }>,
) =>
	Effect.gen(function* () {
		const page = mountCollections(selection);
		const summary = yield* request(page, "current");
		replySummary(page, summary, items);
		return yield* chartRows();
	});

it.effect(
	"shows actual periods and rating-only records, pages real cursors, and retains records on retry",
	() =>
		Effect.gen(function* () {
			const page = mountCollections();
			const summary = yield* request(page, "current");
			const records = yield* request(page, "reviews");
			replySummary(page, summary, [{ count: 2, at: "2026-03-08T05:00:00.000Z" }]);
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
			expect(screen.getByText("Current · 2026-03-08")).toBeDefined();
			expect(screen.getByText("Previous · 2026-03-07")).toBeDefined();
			expect(screen.getByText("0 reviews", { selector: "dd" })).toBeDefined();
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
				waitFor(() =>
					expect(screen.getByRole("button", { name: "Retry review records" })).toBeDefined(),
				),
			);
			expect(screen.getByRole("link", { name: "Archive" })).toBeDefined();
			fireEvent.click(screen.getByRole("button", { name: "Retry review records" }));
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
		expect(rows.map(([period, value]) => [period?.split(" · ").at(-1), value])).toEqual([
			["Mar 1, 2026", "2 reviews"],
			["Mar 2, 2026", "0 reviews"],
			["Mar 3, 2026", "0 reviews"],
			["Mar 4, 2026", "0 reviews"],
			["Mar 5, 2026", "3 reviews"],
			["Mar 6, 2026", "0 reviews"],
			["Mar 7, 2026", "0 reviews"],
		]);
	}),
);

it.effect("requests trend buckets within the shared bucket limit", () =>
	Effect.gen(function* () {
		const summary = yield* request(mountCollections(), "current");
		expect(summary.document.queries.buckets?.output).toMatchObject({
			limit: REPORTING_BUCKET_LIMIT,
		});
	}),
);

it.effect("fills all-time review buckets between the first and last reviewed year", () =>
	Effect.gen(function* () {
		const rows = yield* loadChartRows(
			{ grouping: "year", comparison: "none", range: { kind: "all-time" } },
			[
				{ count: 1, at: "2023-01-01T05:00:00.000Z" },
				{ count: 2, at: "2025-01-01T05:00:00.000Z" },
			],
		);
		expect(rows.map(([, value]) => value)).toEqual(["1 reviews", "0 reviews", "2 reviews"]);
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
		fireEvent.click(screen.getByRole("button", { name: "Retry collection review totals" }));
		yield* request(page, "current", 1);
		expect(page.queryRequests("reviews")).toHaveLength(1);
	}),
);
