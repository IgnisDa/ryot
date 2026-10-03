import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/client-sdk/effect";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/client-sdk/testing";
import { fireEvent, waitFor, within } from "@testing-library/dom";

import { formatDay, formatTime } from "./model";
import { ReadingLog } from "./reading-log";
import MeasurementsPage from "./screen";

afterEach(disposePluginBridges);

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

const rows = (
	items: readonly Record<string, unknown>[],
	pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null } = {
		hasMore: false,
		nextCursor: null,
	},
) => ({ items, type: "rows", pageInfo: { limit: 100, ...pageInfo } });

const summary = (
	id: string,
	name: string,
	unit: string,
	rangeCount: number,
	latestValue: number,
	latestAt: string,
	pinnedAt: string | null = null,
) => ({ id, name, unit, key: id, latestAt, pinnedAt, rangeCount, latestValue, firstAt: latestAt });

const metrics = rows([
	summary("weight", "Weight", "kg", 3, 73.6, daysAgo(2), daysAgo(30)),
	summary("waist", "Waist", "cm", 1, 82, daysAgo(100), daysAgo(20)),
	summary("sugar", "Sugar level", "mg/dL", 0, 130, daysAgo(400)),
]);

const series = (counts: readonly number[], values: readonly number[]) => ({
	type: "timeSeries",
	buckets: counts.map((_, index) => ({
		value: values[index],
		endAt: daysAgo(9 - index),
		startAt: daysAgo(10 - index),
	})),
});

const reading = (
	id: string,
	metricId: string,
	name: string,
	value: number,
	occurredAt: string,
) => ({
	id,
	value,
	metricId,
	occurredAt,
	unit: null,
	comment: null,
	metricName: name,
	metricKey: metricId,
});

const readingsAt = daysAgo(2);
const loggedAt = new Date("2026-05-01T07:30").toISOString();
const logRows = rows([
	reading("r1", "weight", "Weight", 73.6, readingsAt),
	reading("r2", "sugar", "Sugar level", 130, readingsAt),
	reading("r3", "weight", "Weight", 73.1, daysAgo(5)),
]);

const queryData = (queries: Record<string, unknown>, metricRows: typeof metrics) =>
	Object.fromEntries(
		Object.keys(queries).map((key) => {
			if (key === "metrics") {
				return [key, metricRows];
			}
			if (key === "readings") {
				return [key, logRows];
			}
			const average = key.startsWith("average");
			const metric = Number(key.slice(average ? 7 : 5));
			const weight = [
				series([1, 1, 1], average ? [0, 73, 74] : [0, 1, 1]),
				series([1, 1, 1], average ? [82, 0, 0] : [1, 0, 0]),
			][metric];
			return [key, weight ?? series([0, 0, 0], [0, 0, 0])];
		}),
	);

const logMetrics = [{ unit: "kg", id: "weight", name: "Weight" }];

function ReadingLogPage() {
	return (
		<ReadingLog
			range="All"
			timeZone="UTC"
			metrics={logMetrics}
			columns={logMetrics}
			startAt="1970-01-01T00:00:00.000Z"
		/>
	);
}

const openPage = (
	metricRows = metrics,
	options: {
		readonly readingsOnly?: boolean;
		readonly metricsPage?: (after: string | undefined) => ReturnType<typeof rows>;
		readonly readingsPage?: (after: string | undefined) => ReturnType<typeof rows> | null;
	} = {},
) => {
	const page = mountPluginPage(options.readingsOnly ? ReadingLogPage : MeasurementsPage, {
		location: routeLocation("/v/all-measurements"),
		page: savedViewPageContext({
			settings: {},
			dataSources: { queries: {} },
			rendererName: "measurements",
			savedViewId: "all-measurements",
			view: { icon: "ruler", name: "All Measurements" },
		}),
	});
	const answered = new Set<string>();
	const answerPending = () => {
		for (const request of page.queryRequests()) {
			if (!answered.has(request.requestId)) {
				answered.add(request.requestId);
				const data = queryData(request.document.queries, metricRows);
				const metricQuery = request.document.queries.metrics;
				if (options.metricsPage !== undefined && metricQuery?.output.type === "rows") {
					data.metrics = options.metricsPage(metricQuery.output.pagination.after);
				}
				const readingQuery = request.document.queries.readings;
				if (options.readingsPage !== undefined && readingQuery?.output.type === "rows") {
					const readings = options.readingsPage(readingQuery.output.pagination.after);
					if (readings === null) {
						page.replyQuery(request.requestId, { outcome: "failure", reason: "query-failed" });
						continue;
					}
					data.readings = readings;
				}
				page.replyQuery(request.requestId, { outcome: "success", response: { data } });
			}
		}
	};
	return { page, answerPending };
};

const text = (element: Element | null) => element?.textContent ?? "";

describe("measurements page", () => {
	it.live("loads older readings using the next cursor and hides the button at the end", () =>
		Effect.gen(function* () {
			const cursors: Array<string | undefined> = [];
			const { page, answerPending } = openPage(metrics, {
				readingsOnly: true,
				readingsPage: (after) => {
					cursors.push(after);
					return {
						...rows([
							reading(
								after === undefined ? "new" : "old",
								"weight",
								"Weight",
								75,
								daysAgo(after === undefined ? 2 : 10),
							),
						]),
						pageInfo: {
							limit: 100,
							hasMore: after === undefined,
							nextCursor: after === undefined ? "older" : null,
						},
					};
				},
			});
			const body = within(document.body);
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.getByRole("button", { name: "Show more readings" })).toBeTruthy();
				}),
			);
			fireEvent.click(body.getByRole("button", { name: "Show more readings" }));
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(text(body.getByRole("region", { name: "Log" }))).toContain("2 readings");
					expect(body.queryByRole("button", { name: "Show more readings" })).toBeNull();
				}),
			);
			expect(cursors).toEqual([undefined, undefined, "older"]);
			expect(
				page.queryRequests("readings").at(-1)?.document.queries.readings?.output,
			).toMatchObject({ pagination: { after: "older" } });
		}),
	);
	it.live(
		"shows tiles for metrics logged in range, a chart, the metric list and the grouped log",
		() =>
			Effect.gen(function* () {
				const { page, answerPending } = openPage();
				const body = within(document.body);
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(body.getByRole("group", { name: "Pinned metrics" })).toBeTruthy();
						expect(body.getByRole("region", { name: "Log" }).querySelector("table")).not.toBeNull();
					}),
				);
				const chart = body.getByRole("region", { name: "Metric chart" });
				const metricList = body.getByRole("region", { name: "All metrics" });
				const log = body.getByRole("region", { name: "Log" });
				expect(page.container?.querySelector("h1")?.textContent).toBe("All Measurements");
				const pinned = body.getByRole("group", { name: "Pinned metrics" });
				const tiles = within(pinned).getAllByRole("button");
				expect(tiles.map((tile) => text(tile))).toEqual([
					expect.stringContaining("Weight"),
					expect.stringContaining("Waist"),
				]);
				expect(text(tiles[0] ?? null)).toContain("73.6 kg");
				expect(text(tiles[1] ?? null)).toContain("last");
				expect(text(pinned)).toContain("Star one more metric below to pin it here");
				expect(within(chart).getByRole("heading").textContent).toBe("Weight (kg)");
				expect(within(metricList).getAllByRole("row")).toHaveLength(4);

				fireEvent.click(within(metricList).getByRole("button", { name: "Waist" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(within(chart).getByRole("heading").textContent).toBe("Waist (cm)")),
				);

				fireEvent.click(within(metricList).getByRole("button", { name: "Sugar level" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(text(chart)).toContain("No sugar level readings in the last 12 months."),
					),
				);

				expect(text(log)).toContain("2 readings");
				fireEvent.click(within(log).getByRole("button", { name: "+1" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(text(log)).toContain("Sugar level130 mg/dL")),
				);
			}),
	);

	it.live("pins and unpins metrics and blocks pinning beyond the limit", () =>
		Effect.gen(function* () {
			let storedMetrics = rows([
				...metrics.items,
				summary("hip", "Hip", "cm", 0, 95, daysAgo(400)),
			]);
			const { page, answerPending } = openPage(metrics, { metricsPage: () => storedMetrics });
			const body = within(document.body);
			const pinButton = (name: string) => body.getByRole("button", { name: `Pin ${name}` });
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(pinButton("Weight").getAttribute("aria-pressed")).toBe("true");
				}),
			);
			expect(pinButton("Sugar level").getAttribute("aria-pressed")).toBe("false");
			const requests = () =>
				page.clientMessages().filter(({ type }) => type === "operation-request");
			fireEvent.click(pinButton("Sugar level"));
			yield* Effect.promise(() => waitFor(() => expect(requests()).toHaveLength(1)));
			const [pinRequest] = requests();
			assert(pinRequest?.type === "operation-request");
			expect(pinRequest).toMatchObject({
				pluginSlug: "fitness",
				operationSlug: "measurement-metric-pin",
				input: { pinned: true, metricId: "sugar" },
			});
			storedMetrics = rows([
				summary("weight", "Weight", "kg", 3, 73.6, daysAgo(2), daysAgo(30)),
				summary("waist", "Waist", "cm", 1, 82, daysAgo(100), daysAgo(20)),
				summary("sugar", "Sugar level", "mg/dL", 0, 130, daysAgo(400), daysAgo(0)),
				summary("hip", "Hip", "cm", 0, 95, daysAgo(400)),
			]);
			page.send({
				outcome: "success",
				value: { pinned: true },
				type: "operation-result",
				requestId: pinRequest.requestId,
			});
			const pinned = () => body.getByRole("group", { name: "Pinned metrics" });
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(
						within(pinned())
							.getAllByRole("button")
							.map((tile) => text(tile)),
					).toEqual([
						expect.stringContaining("Weight"),
						expect.stringContaining("Waist"),
						expect.stringContaining("Sugar level"),
					]);
				}),
			);
			expect(text(pinned())).not.toContain("Star");
			expect(pinButton("Hip").getAttribute("disabled")).not.toBeNull();
			expect(pinButton("Weight").getAttribute("disabled")).toBeNull();
			fireEvent.click(pinButton("Weight"));
			yield* Effect.promise(() => waitFor(() => expect(requests()).toHaveLength(2)));
			expect(requests()[1]).toMatchObject({
				operationSlug: "measurement-metric-pin",
				input: { pinned: false, metricId: "weight" },
			});
		}),
	);

	it.live("offers metric creation or import when the user has no metrics", () =>
		Effect.gen(function* () {
			const { answerPending } = openPage(rows([]));
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(within(document.body).getByText("No measurements yet")).toBeTruthy();
				}),
			);
			expect(within(document.body).getByRole("button", { name: "Log measurement" })).toBeTruthy();
			expect(within(document.body).getByRole("button", { name: "Add metric" })).toBeTruthy();
		}),
	);

	it.live("creates a metric from the empty state and refreshes its zero-reading row", () =>
		Effect.gen(function* () {
			let storedMetrics = rows([]);
			const { page, answerPending } = openPage(rows([]), {
				readingsPage: () => rows([]),
				metricsPage: () => storedMetrics,
			});
			const body = within(document.body);
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.getByText("No measurements yet")).toBeTruthy();
				}),
			);
			const trigger = body.getByRole("button", { name: "Add metric" });
			trigger.focus();
			fireEvent.click(trigger);
			yield* Effect.promise(() =>
				waitFor(() => expect(body.getByRole("dialog", { name: "Add metric" })).toBeTruthy()),
			);
			const dialog = within(body.getByRole("dialog", { name: "Add metric" }));
			expect(dialog.getByRole("form", { name: "Add metric" }).tagName).toBe("DIV");
			yield* Effect.promise(() =>
				waitFor(() => expect(document.activeElement).toBe(dialog.getByLabelText("Name"))),
			);
			fireEvent.change(dialog.getByLabelText("Name"), { target: { value: " Weight " } });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(dialog.getByLabelText("Unit (optional)").getAttribute("readonly")).not.toBeNull(),
				),
			);
			fireEvent.change(dialog.getByLabelText("Name"), { target: { value: " Blood Pressure " } });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(dialog.getByLabelText("Unit (optional)").getAttribute("readonly")).toBeNull(),
				),
			);
			fireEvent.change(dialog.getByLabelText("Unit (optional)"), { target: { value: " mmHg " } });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(dialog.getByLabelText("Unit (optional)").getAttribute("value")).toBe(" mmHg "),
				),
			);
			fireEvent.click(dialog.getByRole("button", { name: "Add metric" }));
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(
						page.clientMessages().filter(({ type }) => type === "operation-request"),
					).toHaveLength(1);
					expect(
						dialog.getByRole("button", { name: "Adding…" }).getAttribute("disabled"),
					).not.toBeNull();
				}),
			);
			const request = page.clientMessages().find(({ type }) => type === "operation-request");
			assert(request?.type === "operation-request");
			expect(request).toMatchObject({
				pluginSlug: "fitness",
				operationSlug: "measurement-metric-create",
				input: { unit: "mmHg", name: "Blood Pressure" },
			});
			storedMetrics = rows([
				{
					unit: "mmHg",
					firstAt: null,
					rangeCount: 0,
					latestAt: null,
					pinnedAt: null,
					id: "new-metric",
					latestValue: null,
					key: "blood_pressure",
					name: "Blood Pressure",
				},
			]);
			page.send({
				outcome: "success",
				type: "operation-result",
				requestId: request.requestId,
				value: { entityId: "new-metric" },
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.queryByRole("dialog")).toBeNull();
					expect(body.getByRole("button", { name: "Blood Pressure" })).toBeTruthy();
				}),
			);
			expect(text(body.getByRole("region", { name: "All metrics" }))).toContain("0 readings");
			expect(text(body.getByRole("region", { name: "All metrics" }))).toContain("—");
			expect(document.activeElement).toBe(trigger);
		}),
	);

	it.live("deletes every reading in a log row after confirmation and refreshes the log", () =>
		Effect.gen(function* () {
			let storedReadings = logRows;
			const { page, answerPending } = openPage(metrics, {
				readingsOnly: true,
				readingsPage: () => storedReadings,
			});
			const body = within(document.body);
			const rowLabel = `Delete measurement from ${formatDay(readingsAt, "UTC")} ${formatTime(readingsAt, "UTC")}`;
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.getAllByRole("button", { name: /^Delete measurement from/ })).toHaveLength(2);
				}),
			);
			fireEvent.click(body.getByRole("button", { name: rowLabel }));
			yield* Effect.promise(() => waitFor(() => expect(body.getByRole("dialog")).toBeTruthy()));
			const dialog = within(body.getByRole("dialog"));
			expect(text(body.getByRole("dialog"))).toContain("The 2 readings taken on");
			const requests = () =>
				page.clientMessages().filter(({ type }) => type === "operation-request");
			fireEvent.click(dialog.getByRole("button", { name: "Delete measurement" }));
			yield* Effect.promise(() => waitFor(() => expect(requests()).toHaveLength(1)));
			const [failed] = requests();
			assert(failed?.type === "operation-request");
			expect(failed).toMatchObject({
				pluginSlug: "fitness",
				input: { readingIds: ["r1", "r2"] },
				operationSlug: "measurement-reading-delete",
			});
			page.send({
				outcome: "failure",
				type: "operation-result",
				reason: "operation-failed",
				requestId: failed.requestId,
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(dialog.getByRole("alert").textContent).toContain(
						"Demo accounts can't delete measurements",
					),
				),
			);
			fireEvent.click(dialog.getByRole("button", { name: "Delete measurement" }));
			yield* Effect.promise(() => waitFor(() => expect(requests()).toHaveLength(2)));
			const retried = requests()[1];
			assert(retried?.type === "operation-request");
			storedReadings = rows([reading("r3", "weight", "Weight", 73.1, daysAgo(5))]);
			page.send({
				outcome: "success",
				value: { count: 2 },
				type: "operation-result",
				requestId: retried.requestId,
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.queryByRole("dialog")).toBeNull();
					expect(body.getAllByRole("button", { name: /^Delete measurement from/ })).toHaveLength(1);
				}),
			);
			expect(body.queryByRole("button", { name: rowLabel })).toBeNull();
		}),
	);

	it.live("loads every metric page and guards against duplicates beyond the first 100", () =>
		Effect.gen(function* () {
			const allMetrics = Array.from({ length: 101 }, (_, index) => ({
				unit: null,
				firstAt: null,
				rangeCount: 0,
				latestAt: null,
				pinnedAt: null,
				latestValue: null,
				id: `metric-${index}`,
				key: `metric_${index}`,
				name: `Metric ${index}`,
			}));
			const cursors: Array<string | undefined> = [];
			const { page, answerPending } = openPage(rows([]), {
				metricsPage: (after) => {
					cursors.push(after);
					return after === undefined
						? rows(allMetrics.slice(0, 100), { hasMore: true, nextCursor: "metrics-2" })
						: rows(allMetrics.slice(100));
				},
			});
			const body = within(document.body);
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(
						within(body.getByRole("region", { name: "All metrics" })).getAllByRole("row"),
					).toHaveLength(102);
				}),
			);
			expect(cursors).toEqual([undefined, "metrics-2"]);
			fireEvent.click(body.getByRole("button", { name: "Add metric" }));
			yield* Effect.promise(() => waitFor(() => expect(body.getByRole("dialog")).toBeTruthy()));
			const dialog = within(body.getByRole("dialog"));
			fireEvent.change(dialog.getByLabelText("Name"), { target: { value: " Metric 100 " } });
			yield* Effect.promise(() =>
				waitFor(() => expect(dialog.getByRole("alert").textContent).toContain("already exists")),
			);
			expect(
				dialog.getByRole("button", { name: "Add metric" }).getAttribute("disabled"),
			).not.toBeNull();
			expect(page.clientMessages().filter(({ type }) => type === "operation-request")).toEqual([]);
		}),
	);

	it.live("retains the form on save failure and allows retrying", () =>
		Effect.gen(function* () {
			const { page, answerPending } = openPage();
			const body = within(document.body);
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.getByRole("region", { name: "All metrics" })).toBeTruthy();
				}),
			);
			fireEvent.click(body.getByRole("button", { name: "Add metric" }));
			yield* Effect.promise(() => waitFor(() => expect(body.getByRole("dialog")).toBeTruthy()));
			const dialog = within(body.getByRole("dialog"));
			fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "!!!" } });
			fireEvent.click(dialog.getByRole("button", { name: "Add metric" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(dialog.getByRole("alert").textContent).toContain("Enter a name")),
			);
			expect(page.clientMessages().filter(({ type }) => type === "operation-request")).toEqual([]);
			fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Mood" } });
			yield* Effect.promise(() =>
				waitFor(() => expect(dialog.getByLabelText("Name").getAttribute("value")).toBe("Mood")),
			);
			fireEvent.keyDown(dialog.getByLabelText("Name"), { key: "Enter" });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						page.clientMessages().filter(({ type }) => type === "operation-request"),
					).toHaveLength(1),
				),
			);
			const request = page.clientMessages().find(({ type }) => type === "operation-request");
			assert(request?.type === "operation-request");
			page.send({
				outcome: "failure",
				type: "operation-result",
				reason: "operation-failed",
				requestId: request.requestId,
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(dialog.getByRole("alert").textContent).toContain("couldn't be added")),
			);
			expect(dialog.getByLabelText("Name").getAttribute("value")).toBe("Mood");
			fireEvent.click(dialog.getByRole("button", { name: "Add metric" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						page.clientMessages().filter(({ type }) => type === "operation-request"),
					).toHaveLength(2),
				),
			);
		}),
	);

	it.live(
		"preserves loaded readings on a later-page error and retries without repeating rows",
		() =>
			Effect.gen(function* () {
				let failOlder = true;
				const { answerPending } = openPage(metrics, {
					readingsOnly: true,
					readingsPage: (after) => {
						if (after === "older" && failOlder) {
							return null;
						}
						return after === undefined
							? rows([reading("new", "weight", "Weight", 75, daysAgo(2))], {
									hasMore: true,
									nextCursor: "older",
								})
							: rows([reading("old", "weight", "Weight", 74, daysAgo(10))]);
					},
				});
				const body = within(document.body);
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(body.getByRole("button", { name: "Show more readings" })).toBeTruthy();
					}),
				);
				fireEvent.click(body.getByRole("button", { name: "Show more readings" }));
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(body.getByText("More readings couldn't be loaded.")).toBeTruthy();
					}),
				);
				expect(text(body.getByRole("region", { name: "Log" }))).toContain("1+ reading");
				failOlder = false;
				fireEvent.click(
					within(body.getByRole("region", { name: "Log" })).getByRole("button", {
						name: "Try again",
					}),
				);
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(text(body.getByRole("region", { name: "Log" }))).toContain("2 readings");
						expect(body.queryByText("More readings couldn't be loaded.")).toBeNull();
					}),
				);
				expect(within(body.getByRole("region", { name: "Log" })).getAllByRole("row")).toHaveLength(
					4,
				);
			}),
	);

	it.live("fails malformed metric pagination instead of repeating the first page", () =>
		Effect.gen(function* () {
			const { page, answerPending } = openPage(rows([], { hasMore: true, nextCursor: null }));
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(
						within(document.body).getByText("Your measurements couldn't be loaded."),
					).toBeTruthy();
				}),
			);
			expect(page.queryRequests("metrics")).toHaveLength(1);
		}),
	);

	it.live("logs entered values, including zero, at one time and keeps the form on failure", () =>
		Effect.gen(function* () {
			const { page, answerPending } = openPage();
			const body = within(document.body);
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.getByRole("region", { name: "All metrics" })).toBeTruthy();
				}),
			);
			const trigger = body.getByRole("button", { name: "Log measurement" });
			fireEvent.click(trigger);
			yield* Effect.promise(() =>
				waitFor(() => expect(body.getByRole("dialog", { name: "Log measurement" })).toBeTruthy()),
			);
			const dialog = within(body.getByRole("dialog", { name: "Log measurement" }));
			expect(dialog.getByLabelText("Weight (kg)").getAttribute("value")).toBe("");
			expect(dialog.getByLabelText("Waist (cm)").getAttribute("value")).toBe("");
			expect(dialog.queryByLabelText("Sugar level (mg/dL)")).toBeNull();
			const requests = () =>
				page.clientMessages().filter(({ type }) => type === "operation-request");
			fireEvent.click(dialog.getByRole("button", { name: "Save" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(dialog.getByRole("alert").textContent).toBe("Enter at least one value."),
				),
			);
			fireEvent.change(dialog.getByLabelText("Weight (kg)"), { target: { value: "heavy" } });
			yield* Effect.promise(() =>
				waitFor(() => expect(dialog.getByRole("alert").textContent).toBe("Enter a number.")),
			);
			fireEvent.change(dialog.getByLabelText("Weight (kg)"), { target: { value: " 0 " } });
			fireEvent.click(dialog.getByRole("button", { name: "Remove Waist" }));
			fireEvent.click(dialog.getByRole("button", { name: /^Add metric value/ }));
			yield* Effect.promise(() =>
				waitFor(() => expect(body.getByRole("radio", { name: "Sugar level" })).toBeTruthy()),
			);
			fireEvent.click(body.getByRole("radio", { name: "Sugar level" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(dialog.getByLabelText("Sugar level (mg/dL)")).toBeTruthy()),
			);
			fireEvent.change(dialog.getByLabelText("Sugar level (mg/dL)"), {
				target: { value: "121.5" },
			});
			fireEvent.change(dialog.getByLabelText("Date and time"), {
				target: { value: "2026-05-01T07:30" },
			});
			fireEvent.change(dialog.getByLabelText("Comment (optional)"), {
				target: { value: " Fasted " },
			});
			expect(requests()).toEqual([]);
			fireEvent.click(dialog.getByRole("button", { name: "Save" }));
			yield* Effect.promise(() => waitFor(() => expect(requests()).toHaveLength(1)));
			const [failed] = requests();
			assert(failed?.type === "operation-request");
			expect(failed).toMatchObject({
				pluginSlug: "fitness",
				operationSlug: "measurement-reading-log",
				input: {
					comment: "Fasted",
					occurredAt: loggedAt,
					values: [
						{ value: 0, metricId: "weight" },
						{ value: 121.5, metricId: "sugar" },
					],
				},
			});
			page.send({
				outcome: "failure",
				reason: "transport",
				type: "operation-result",
				requestId: failed.requestId,
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(text(dialog.getByRole("form"))).toContain("couldn't be saved")),
			);
			expect(dialog.getByLabelText("Weight (kg)").getAttribute("value")).toBe(" 0 ");
			const readingQueries = page.queryRequests("readings").length;
			fireEvent.click(dialog.getByRole("button", { name: "Save" }));
			yield* Effect.promise(() => waitFor(() => expect(requests()).toHaveLength(2)));
			const retried = requests()[1];
			assert(retried?.type === "operation-request");
			expect(retried.input).toEqual(failed.input);
			page.send({
				outcome: "success",
				value: { count: 2 },
				type: "operation-result",
				requestId: retried.requestId,
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.queryByRole("dialog")).toBeNull();
					expect(page.queryRequests("readings").length).toBeGreaterThan(readingQueries);
				}),
			);
			expect(document.activeElement).toBe(trigger);
		}),
	);

	it.live("edits a log row by updating, adding, and clearing values at its original time", () =>
		Effect.gen(function* () {
			const { page, answerPending } = openPage();
			const body = within(document.body);
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.getAllByRole("button", { name: /^Edit measurement from/ })).toHaveLength(2);
				}),
			);
			fireEvent.click(
				body.getAllByRole("button", { name: /^Edit measurement from/ })[0] ?? document.body,
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(body.getByRole("dialog", { name: "Edit measurement" })).toBeTruthy()),
			);
			const dialog = within(body.getByRole("dialog", { name: "Edit measurement" }));
			expect(dialog.getByLabelText("Weight (kg)").getAttribute("value")).toBe("73.6");
			expect(dialog.getByLabelText("Sugar level (mg/dL)").getAttribute("value")).toBe("130");
			expect(dialog.queryByLabelText("Waist (cm)")).toBeNull();
			fireEvent.change(dialog.getByLabelText("Weight (kg)"), { target: { value: "0" } });
			fireEvent.change(dialog.getByLabelText("Sugar level (mg/dL)"), { target: { value: "" } });
			fireEvent.click(dialog.getByRole("button", { name: /^Add metric value/ }));
			yield* Effect.promise(() =>
				waitFor(() => expect(body.getByRole("radio", { name: "Waist" })).toBeTruthy()),
			);
			fireEvent.click(body.getByRole("radio", { name: "Waist" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(dialog.getByLabelText("Waist (cm)")).toBeTruthy()),
			);
			fireEvent.change(dialog.getByLabelText("Waist (cm)"), { target: { value: "80" } });
			fireEvent.click(dialog.getByRole("button", { name: "Save" }));
			const requests = () =>
				page.clientMessages().filter(({ type }) => type === "operation-request");
			yield* Effect.promise(() => waitFor(() => expect(requests()).toHaveLength(1)));
			const [request] = requests();
			assert(request?.type === "operation-request");
			expect(request).toMatchObject({
				pluginSlug: "fitness",
				operationSlug: "measurement-reading-update",
				input: {
					comment: "",
					occurredAt: readingsAt,
					readingIds: ["r1", "r2"],
					values: [
						{ value: 0, metricId: "weight" },
						{ value: 80, metricId: "waist" },
					],
				},
			});
			page.send({
				outcome: "success",
				value: { count: 3 },
				type: "operation-result",
				requestId: request.requestId,
			});
			yield* Effect.promise(() => waitFor(() => expect(body.queryByRole("dialog")).toBeNull()));
		}),
	);
});
