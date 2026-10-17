import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, waitFor, within } from "@testing-library/dom";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { MeasurementDialogs, useMeasurementLogger } from "./measurement-logger";
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
	occurredAt,
	comment: null,
	readings: [{ value, metricId, metricName: name, id: `${id}-reading` }],
});

const readingsAt = daysAgo(2);
const loggedAt = new Date("2026-05-01T07:30").toISOString();
const logRows = rows([
	{
		...reading("r1", "weight", "Weight", 73.6, readingsAt),
		readings: [
			{ id: "r1", value: 73.6, metricId: "weight" },
			{ id: "r2", value: 130, metricId: "sugar" },
		],
	},
	reading("r3", "weight", "Weight", 73.1, daysAgo(5)),
]);

const queryData = (queries: Record<string, unknown>, metricRows: typeof metrics) =>
	Object.fromEntries(
		Object.keys(queries).map((key) => {
			if (key === "metrics") {
				return [key, metricRows];
			}
			if (key === "entries") {
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
	return <ReadingLog range="All" timeZone="UTC" metrics={logMetrics} columns={logMetrics} />;
}

function MeasurementLoggerPage() {
	const { log, close, retry, error, dialog, loading, trigger, setTrigger, unavailable } =
		useMeasurementLogger();
	return (
		<>
			<button type="button" onClick={log} ref={setTrigger} disabled={unavailable}>
				Log measurement
			</button>
			{error ? (
				<>
					<p>Your measurements couldn&apos;t be loaded.</p>
					<button type="button" onClick={retry}>
						Try again
					</button>
				</>
			) : null}
			{loading ? <p>Loading measurements…</p> : null}
			<MeasurementDialogs dialog={dialog} onClose={close} trigger={trigger} />
		</>
	);
}

const openPage = (
	metricRows = metrics,
	options: {
		readonly readingsOnly?: boolean;
		readonly loggerOnly?: boolean;
		readonly metricsPage?: (after: string | undefined) => ReturnType<typeof rows> | null;
		readonly readingsPage?: (after: string | undefined) => ReturnType<typeof rows> | null;
		readonly entryReadingsPage?: (
			entryId: string,
			after: string | undefined,
		) => ReturnType<typeof rows> | null | undefined;
	} = {},
) => {
	let pageComponent = MeasurementsPage;
	if (options.readingsOnly) {
		pageComponent = ReadingLogPage;
	} else if (options.loggerOnly) {
		pageComponent = MeasurementLoggerPage;
	}
	const page = mountPluginPage(pageComponent, {
		location: routeLocation("/v/all-measurements"),
		page: {
			...savedViewPageContext({
				settings: {},
				dataSources: { queries: {} },
				rendererName: "measurements",
				savedViewId: "all-measurements",
				view: { icon: "ruler", name: "All Measurements" },
			}),
			contributors: [
				pluginContributor({
					name: "fitness",
					pluginId: "fitness-owner",
					packageId: PLUGIN_PACKAGE_ID,
				}),
			],
		},
	});
	const answered = new Set<string>();
	const entryReadings = new Map<string, unknown>();
	const rememberEntries = (entries: ReturnType<typeof rows>) => {
		for (const entry of entries.items) {
			assert(typeof entry.id === "string");
			entryReadings.set(entry.id, entry.readings);
		}
	};
	rememberEntries(logRows);
	const answerPending = () => {
		for (const request of page.queryRequests()) {
			if (!answered.has(request.requestId)) {
				answered.add(request.requestId);
				const data = queryData(request.document.queries, metricRows);
				const metricQuery = request.document.queries.metrics;
				if (options.metricsPage !== undefined && metricQuery?.output.type === "rows") {
					const metricPage = options.metricsPage(metricQuery.output.pagination.after);
					if (metricPage === null) {
						page.replyQuery(request.requestId, { outcome: "failure", reason: "query-failed" });
						continue;
					}
					data.metrics = metricPage;
				}
				const readingQuery = request.document.queries.entries;
				if (options.readingsPage !== undefined && readingQuery?.output.type === "rows") {
					const readings = options.readingsPage(readingQuery.output.pagination.after);
					if (readings === null) {
						page.replyQuery(request.requestId, { outcome: "failure", reason: "query-failed" });
						continue;
					}
					rememberEntries(readings);
					data.entries = readings;
				}
				const children = request.document.queries.readings;
				if (children !== undefined) {
					assert(children.where?.type === "and");
					const session = children.where.predicates[0];
					assert(
						session?.type === "comparison" &&
							session.right.type === "literal" &&
							typeof session.right.value === "string",
					);
					if (options.entryReadingsPage !== undefined) {
						assert(children.output.type === "rows");
						const childPage = options.entryReadingsPage(
							session.right.value,
							children.output.pagination.after,
						);
						if (childPage === undefined) {
							answered.delete(request.requestId);
							continue;
						}
						if (childPage === null) {
							page.replyQuery(request.requestId, { outcome: "failure", reason: "query-failed" });
							continue;
						}
						data.readings = childPage;
					} else {
						const readings = entryReadings.get(session.right.value);
						assert(Array.isArray(readings));
						data.readings = rows(readings);
					}
				}
				page.replyQuery(request.requestId, { outcome: "success", response: { data } });
			}
		}
	};
	return { page, answerPending };
};

const text = (element: Element | null) => element?.textContent ?? "";

describe("measurements page", () => {
	it.live("keeps equal-time submissions and their comments separate", () =>
		Effect.gen(function* () {
			const at = daysAgo(2);
			const { page, answerPending } = openPage(metrics, {
				readingsOnly: true,
				readingsPage: () =>
					rows([
						{ ...reading("first-entry", "weight", "Weight", 70, at), comment: "Before run" },
						{ ...reading("second-entry", "weight", "Weight", 72, at), comment: "After run" },
					]),
			});
			const body = within(document.body);
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.getAllByRole("button", { name: /^Delete measurement from/ })).toHaveLength(2);
				}),
			);
			expect(body.getByText("Before run")).toBeTruthy();
			expect(body.getByText("After run")).toBeTruthy();
			fireEvent.click(
				body.getAllByRole("button", { name: /^Delete measurement from/ })[1] ?? document.body,
			);
			yield* Effect.promise(() => waitFor(() => expect(body.getByRole("dialog")).toBeTruthy()));
			fireEvent.click(
				within(body.getByRole("dialog")).getByRole("button", { name: "Delete measurement" }),
			);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(page.clientMessages()).toContainEqual(
						expect.objectContaining({
							type: "operation-request",
							input: { entryId: "second-entry" },
						}),
					),
				),
			);
		}),
	);

	it.live(
		"loads all 101 children before exposing an entry and deletes by entry ID before older entries load",
		() =>
			Effect.gen(function* () {
				let release = false;
				const cursors: Array<string | undefined> = [];
				const children = Array.from({ length: 101 }, (_, index) => ({
					value: index,
					id: `child-${index}`,
					metricId: index === 0 ? "weight" : `metric-${index}`,
				}));
				const { page, answerPending } = openPage(metrics, {
					readingsOnly: true,
					readingsPage: (after) => {
						cursors.push(after);
						return rows([reading("large-entry", "weight", "Weight", 0, readingsAt)], {
							hasMore: true,
							nextCursor: "older-entries",
						});
					},
					entryReadingsPage: (_, after) => {
						if (after === undefined) {
							return rows(children.slice(0, 100), { hasMore: true, nextCursor: "last-child" });
						}
						return release ? rows(children.slice(100)) : undefined;
					},
				});
				const body = within(document.body);
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(page.queryRequests("readings")).toHaveLength(2);
					}),
				);
				expect(body.queryByRole("button", { name: /^Delete measurement from/ })).toBeNull();
				release = true;
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(body.getByRole("button", { name: /^Delete measurement from/ })).toBeTruthy();
					}),
				);
				fireEvent.click(body.getByRole("button", { name: /^Delete measurement from/ }));
				yield* Effect.promise(() => waitFor(() => expect(body.getByRole("dialog")).toBeTruthy()));
				expect(body.getByRole("dialog").textContent).toContain("101 readings");
				fireEvent.click(
					within(body.getByRole("dialog")).getByRole("button", { name: "Delete measurement" }),
				);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual(
							expect.objectContaining({
								type: "operation-request",
								input: { entryId: "large-entry" },
							}),
						),
					),
				);
				expect(cursors).toEqual([undefined]);
			}),
	);

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
			expect(cursors).toEqual([undefined, "older"]);
			expect(page.queryRequests("entries").at(-1)?.document.queries.entries?.output).toMatchObject({
				pagination: { after: "older" },
			});
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
				packageId: PLUGIN_PACKAGE_ID,
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
				packageId: PLUGIN_PACKAGE_ID,
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

	it.live("retries the logger metrics query and opens metric creation when none exist", () =>
		Effect.gen(function* () {
			let fail = true;
			const { page, answerPending } = openPage(rows([]), {
				loggerOnly: true,
				metricsPage: () => (fail ? null : rows([])),
			});
			const body = within(document.body);
			yield* Effect.promise(() =>
				waitFor(() => expect(body.getByText("Loading measurements…")).toBeTruthy()),
			);
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.getByText("Your measurements couldn't be loaded.")).toBeTruthy();
				}),
			);
			const trigger = body.getByRole("button", { name: "Log measurement" });
			expect(trigger.hasAttribute("disabled")).toBe(true);
			fail = false;
			fireEvent.click(body.getByRole("button", { name: "Try again" }));
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(trigger.hasAttribute("disabled")).toBe(false);
				}),
			);
			fireEvent.click(trigger);
			yield* Effect.promise(() =>
				waitFor(() => expect(body.getByRole("dialog", { name: "Add metric" })).toBeTruthy()),
			);
			expect(page.queryRequests("metrics")).toHaveLength(2);
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
				input: { entryId: "r1" },
				packageId: PLUGIN_PACKAGE_ID,
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
					expect(dialog.getByRole("alert").textContent).toContain("couldn't be deleted"),
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
			const { page, answerPending } = openPage(metrics, { loggerOnly: true });
			const body = within(document.body);
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(
						body.getByRole("button", { name: "Log measurement" }).hasAttribute("disabled"),
					).toBe(false);
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
				packageId: PLUGIN_PACKAGE_ID,
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
				waitFor(() =>
					expect(text(dialog.getByRole("form"))).toContain("Some readings may already be saved"),
				),
			);
			expect(dialog.getByLabelText("Weight (kg)").getAttribute("value")).toBe(" 0 ");
			const metricQueries = page.queryRequests("metrics").length;
			fireEvent.click(dialog.getByRole("button", { name: "Retry save" }));
			yield* Effect.promise(() => waitFor(() => expect(requests()).toHaveLength(2)));
			const retried = requests()[1];
			assert(retried?.type === "operation-request");
			expect(retried.input).toEqual(failed.input);
			page.send({
				outcome: "success",
				type: "operation-result",
				requestId: retried.requestId,
				value: { count: 2, status: "saved" },
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.queryByRole("dialog")).toBeNull();
					expect(page.queryRequests("metrics").length).toBeGreaterThan(metricQueries);
				}),
			);
			expect(document.activeElement).toBe(trigger);
		}),
	);

	it.live("cancels unsent input and retains partial submissions until retry completes", () =>
		Effect.gen(function* () {
			const { page, answerPending } = openPage(metrics, { loggerOnly: true });
			const body = within(document.body);
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(
						body.getByRole("button", { name: "Log measurement" }).hasAttribute("disabled"),
					).toBe(false);
				}),
			);
			const trigger = body.getByRole("button", { name: "Log measurement" });
			const requests = () =>
				page.clientMessages().filter(({ type }) => type === "operation-request");
			fireEvent.click(trigger);
			yield* Effect.promise(() =>
				waitFor(() => expect(body.getByRole("dialog", { name: "Log measurement" })).toBeTruthy()),
			);
			let dialog = within(body.getByRole("dialog", { name: "Log measurement" }));
			fireEvent.change(dialog.getByLabelText("Weight (kg)"), { target: { value: "72" } });
			fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
			yield* Effect.promise(() => waitFor(() => expect(body.queryByRole("dialog")).toBeNull()));
			expect(requests()).toEqual([]);
			fireEvent.click(trigger);
			yield* Effect.promise(() =>
				waitFor(() => expect(body.getByRole("dialog", { name: "Log measurement" })).toBeTruthy()),
			);
			dialog = within(body.getByRole("dialog", { name: "Log measurement" }));
			expect(dialog.getByLabelText("Weight (kg)").getAttribute("value")).toBe("");
			fireEvent.change(dialog.getByLabelText("Weight (kg)"), { target: { value: "0" } });
			fireEvent.change(dialog.getByLabelText("Waist (cm)"), { target: { value: "80" } });
			fireEvent.click(dialog.getByRole("button", { name: "Save" }));
			yield* Effect.promise(() => waitFor(() => expect(requests()).toHaveLength(1)));
			const first = requests()[0];
			assert(first?.type === "operation-request");
			expect(dialog.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
			const metricQueries = page.queryRequests("metrics").length;
			page.send({
				outcome: "success",
				type: "operation-result",
				requestId: first.requestId,
				value: { count: 1, status: "incomplete" },
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(dialog.getByRole("button", { name: "Retry save" })).toBeTruthy()),
			);
			expect(dialog.getByLabelText("Weight (kg)").closest("fieldset")?.disabled).toBe(true);
			expect(dialog.getByRole("alert").textContent).toContain("does not undo saved readings");
			yield* Effect.promise(() =>
				waitFor(() => expect(page.queryRequests("metrics").length).toBeGreaterThan(metricQueries)),
			);
			expect(body.getByRole("dialog", { name: "Log measurement" })).toBeTruthy();
			expect(dialog.getByLabelText("Weight (kg)").getAttribute("value")).toBe("0");
			answerPending();
			fireEvent.click(dialog.getByRole("button", { name: "Retry save" }));
			yield* Effect.promise(() => waitFor(() => expect(requests()).toHaveLength(2)));
			const retry = requests()[1];
			assert(retry?.type === "operation-request");
			expect(retry.input).toEqual(first.input);
			page.send({
				outcome: "success",
				type: "operation-result",
				requestId: retry.requestId,
				value: { count: 2, status: "saved" },
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(body.queryByRole("dialog")).toBeNull();
				}),
			);
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
				packageId: PLUGIN_PACKAGE_ID,
				operationSlug: "measurement-reading-update",
				input: {
					comment: "",
					entryId: "r1",
					occurredAt: readingsAt,
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
