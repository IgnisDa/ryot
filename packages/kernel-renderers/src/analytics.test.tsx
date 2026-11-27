import { afterEach, expect } from "bun:test";

import { PluginId } from "@ryot-app/contract/schema/brands";
import type { ClientPageContext, PluginUserPreferences } from "@ryot-app/plugin-client-contract";
import type { Entitlement } from "@ryot-app/plugin-client-sdk";
import {
	analyticsSectionKey,
	type AnalyticsSectionProps,
	reportingSearchParams,
	type ReportingSelection,
	TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	testCatalog,
} from "@ryot-app/plugin-client-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import AnalyticsPage from "./analytics";

afterEach(() => {
	disposePluginBridges();
});

const sectionCatalog = testCatalog("test-sections", {
	"section.only": "Only",
	"section.first": "First",
	"section.range": "Range",
	"section.second": "Second",
	"section.activity": "Activity",
});

const context: ClientPageContext = {
	settings: {},
	contributors: [],
	dataSources: null,
	route: { params: {} },
	renderer: { kind: "kernel", name: "Analytics" },
	view: { name: "Analytics", icon: "chart-column" },
	target: { kind: "saved-view", reference: { kind: "kernel", slug: "analytics" } },
};

const FixtureSection = ({ timeZone, reference, selection }: AnalyticsSectionProps) => (
	<p>
		{reference.pluginId} / {selection.range.kind} / {timeZone}
	</p>
);

const reportingSearch = (selection: ReportingSelection) =>
	new URLSearchParams(
		Object.entries(reportingSearchParams(selection)).flatMap(([key, value]) =>
			value === null ? [] : [[key, value]],
		),
	);

const pageSearchUpdates = (page: ReturnType<typeof mountPluginPage>) =>
	page.clientMessages().flatMap((message) => (message.type === "page-search" ? [message] : []));

const periodCaptions = () => {
	const controls = screen.getByRole("region", { name: "Analytics controls" });
	return within(controls).getByText(/^· times in /).parentElement?.textContent;
};

const RangeSection = ({ selection }: AnalyticsSectionProps) => (
	<p>range input {JSON.stringify(selection.range)}</p>
);

const sectionRange = () => screen.getByText(/^range input /).textContent;

const answerPreferences = (
	page: ReturnType<typeof mountPluginPage>,
	entitlements: readonly Entitlement[] = ["pro"],
) =>
	waitFor(() => {
		const request = page.clientMessages().find((message) => message.type === "account-request");
		if (!request) {
			throw new Error("No reporting request");
		}
		page.send({
			outcome: "success",
			type: "account-result",
			requestId: request.requestId,
			account: {
				entitlements,
				preferences: {
					weekStart: 1,
					ratingScale: "hundred",
					timeZone: TimeZone.make("Asia/Kolkata"),
				},
			},
		});
	});

const answerUserPreferences = (
	page: ReturnType<typeof mountPluginPage>,
	requestNumber: number,
	result:
		| { readonly outcome: "failure"; readonly reason: "transport" }
		| { readonly outcome: "success"; readonly preferences: PluginUserPreferences },
) =>
	waitFor(() => {
		const request = page.clientMessages().filter((message) => message.type === "account-request")[
			requestNumber - 1
		];
		if (!request) {
			throw new Error("No user preferences request");
		}
		page.send(
			result.outcome === "failure"
				? { ...result, type: "account-result", requestId: request.requestId }
				: {
						outcome: "success",
						type: "account-result",
						requestId: request.requestId,
						account: { entitlements: ["pro"], preferences: result.preferences },
					},
		);
	});

const mountControls = (search: string) => {
	const page = mountPluginPage(AnalyticsPage, { page: context, catalogs: [sectionCatalog] });
	page.navigate(routeLocation("/v/k/analytics", search));
	return page;
};

it.effect(
	"retains loaded analytics with an error when reporting preferences refresh fails",
	() =>
		Effect.gen(function* () {
			let attempts = 0;
			const section = { slug: "activity", ownerPluginId: PluginId.make("first-local") };
			const search = new URLSearchParams();
			search.set("section", analyticsSectionKey(section));
			const page = mountPluginPage(AnalyticsPage, {
				page: context,
				catalogs: [sectionCatalog],
				onClientMessage: (message) => {
					if (message.type === "account-request") {
						attempts += 1;
					}
				},
				analyticsSections: [
					{
						icon: "box",
						name: { key: "section.activity", namespace: "test-sections" },
						...section,
						load: () => Promise.resolve(FixtureSection),
					},
				],
			});
			page.navigate(routeLocation("/v/k/analytics", `?${search}`));
			yield* Effect.promise(() =>
				answerUserPreferences(page, 1, {
					outcome: "success",
					preferences: { weekStart: 1, ratingScale: "hundred", timeZone: TimeZone.make("UTC") },
				}),
			);
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(attempts).toBe(1);
					expect(screen.getByText("· times in UTC")).toBeDefined();
					expect(screen.getByText("first-local / rolling / UTC")).toBeDefined();
				}),
			);

			page.send({ type: "page-refresh" });
			yield* Effect.promise(() =>
				answerUserPreferences(page, 2, { outcome: "failure", reason: "transport" }),
			);
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(attempts).toBe(2);
					const alert = screen.getByRole("alert");
					expect(alert.textContent).toContain("Could not refresh. Showing the last loaded values.");
					expect(screen.getByText("· times in UTC")).toBeDefined();
					expect(screen.getByText("first-local / rolling / UTC")).toBeDefined();
				}),
			);

			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
			yield* Effect.promise(() =>
				answerUserPreferences(page, 3, {
					outcome: "success",
					preferences: {
						weekStart: 1,
						ratingScale: "hundred",
						timeZone: TimeZone.make("Asia/Kolkata"),
					},
				}),
			);
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(attempts).toBe(3);
					expect(screen.queryByRole("alert")).toBeNull();
					expect(screen.getByText("· times in Asia/Kolkata")).toBeDefined();
					expect(screen.getByText("first-local / rolling / Asia/Kolkata")).toBeDefined();
				}),
			);
		}),
	testTimeout,
);

const choose = (label: string, choice: string) =>
	Effect.gen(function* () {
		fireEvent.click(screen.getByRole("combobox", { name: new RegExp(`^${label}:`) }));
		const option = yield* Effect.promise(() => screen.findByRole("option", { name: choice }));
		fireEvent.pointerDown(option, { pointerType: "mouse" });
		fireEvent.click(option);
		yield* Effect.promise(() =>
			waitFor(() => expect(screen.queryByRole("listbox", { name: label })).toBeNull()),
		);
	});

it.effect(
	"mounts only the selected generic contributor and retries it without loading its sibling",
	() =>
		Effect.gen(function* () {
			const loaded: string[] = [];
			let attempts = 0;
			const page = mountPluginPage(AnalyticsPage, {
				page: context,
				catalogs: [sectionCatalog],
				analyticsSections: [
					{
						icon: "box",
						slug: "activity",
						ownerPluginId: PluginId.make("first-local"),
						name: { key: "section.first", namespace: "test-sections" },
						load: () => {
							loaded.push("first");
							return Promise.resolve(FixtureSection);
						},
					},
					{
						icon: "box",
						slug: "activity",
						ownerPluginId: PluginId.make("second-local"),
						name: { key: "section.second", namespace: "test-sections" },
						load: () => {
							loaded.push("second");
							attempts += 1;
							return attempts === 1
								? Promise.reject(new Error("Unavailable"))
								: Promise.resolve(FixtureSection);
						},
					},
				],
			});
			const search = reportingSearch({
				grouping: "year",
				comparison: "none",
				range: { kind: "all-time" },
			});
			search.set(
				"section",
				analyticsSectionKey({ slug: "activity", ownerPluginId: PluginId.make("second-local") }),
			);
			page.navigate(routeLocation("/v/k/analytics", `?${search}`));
			yield* Effect.promise(() =>
				waitFor(() => {
					const request = page
						.clientMessages()
						.find((message) => message.type === "account-request");
					if (!request) {
						throw new Error("No reporting request");
					}
					page.send({
						outcome: "success",
						type: "account-result",
						requestId: request.requestId,
						account: {
							entitlements: ["pro"],
							preferences: {
								weekStart: 1,
								ratingScale: "hundred",
								timeZone: TimeZone.make("Europe/Paris"),
							},
						},
					});
				}),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByText("Could not load this section.")).toBeDefined()),
			);
			expect(loaded).toEqual(["second"]);
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByText("second-local / all-time / Europe/Paris")).toBeDefined(),
				),
			);
			expect(loaded).toEqual(["second", "second"]);
			const firstSearch = new URLSearchParams({
				section: analyticsSectionKey({
					slug: "activity",
					ownerPluginId: PluginId.make("first-local"),
				}),
			});
			page.navigate(routeLocation("/v/k/analytics", `?${firstSearch}`), {
				index: 1,
				key: "first-section",
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByText("first-local / rolling / Europe/Paris")).toBeDefined(),
				),
			);
			expect(loaded).toEqual(["second", "second", "first"]);
		}),
	testTimeout,
);

it.effect(
	"selects the only contributor without section navigation for an absent section",
	() =>
		Effect.gen(function* () {
			const page = mountPluginPage(AnalyticsPage, {
				page: context,
				catalogs: [sectionCatalog],
				analyticsSections: [
					{
						icon: "box",
						slug: "activity",
						ownerPluginId: PluginId.make("only-local"),
						load: () => Promise.resolve(FixtureSection),
						name: { key: "section.only", namespace: "test-sections" },
					},
				],
			});
			page.navigate(routeLocation("/v/k/analytics"));
			yield* Effect.promise(() => answerPreferences(page));
			yield* Effect.promise(() => screen.findByText("only-local / rolling / Asia/Kolkata"));
			expect(screen.queryByRole("radiogroup", { name: "Analytics sections" })).toBeNull();
		}),
	testTimeout,
);

it.effect(
	"renders an empty state with effective preferences and zero plugin contributors",
	() =>
		Effect.gen(function* () {
			const page = mountPluginPage(AnalyticsPage, { page: context, catalogs: [sectionCatalog] });
			page.navigate(routeLocation("/v/k/analytics"));
			yield* Effect.promise(() => answerPreferences(page));
			yield* Effect.promise(() => screen.findByText("No analytics available"));
			expect(screen.getByText("· times in Asia/Kolkata")).toBeDefined();
			expect(screen.getAllByRole("heading", { level: 1, name: "Analytics" })).toHaveLength(1);
		}),
	testTimeout,
);

it.effect(
	"keeps free accounts on free ranges and locks Pro ranges",
	() =>
		Effect.gen(function* () {
			const search = reportingSearch({
				grouping: "week",
				comparison: "previous-period",
				range: { days: 90, kind: "rolling" },
			});
			search.set("section", "contributor/activity");
			const page = mountControls(`?${search}`);
			yield* Effect.promise(() => answerPreferences(page, []));
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("combobox", { name: "Range: Last 30 days" })),
			);
			const locked = yield* Effect.promise(() =>
				screen.findByRole("option", { name: "Last 90 days (Pro)" }),
			);
			expect(locked.getAttribute("aria-disabled")).toBe("true");
			expect(
				screen.getByRole("option", { name: "Last 7 days" }).getAttribute("aria-disabled"),
			).toBeNull();
		}),
	testTimeout,
);

it.effect(
	"decodes controls from the URL and follows incoming history state",
	() =>
		Effect.gen(function* () {
			const firstSelection = {
				grouping: "week",
				comparison: "previous-period",
				range: { days: 90, kind: "rolling" },
			} as const;
			const firstSearch = reportingSearch(firstSelection);
			firstSearch.set("section", "contributor/activity");
			const page = mountControls(`?${firstSearch}`);
			yield* Effect.promise(() => answerPreferences(page));
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(screen.getByRole("combobox", { name: "Range: Last 90 days" })).toBeDefined();
					expect(screen.getByRole("combobox", { name: "Compare: Previous period" })).toBeDefined();
					expect(screen.getByRole("combobox", { name: "Group by: Week" })).toBeDefined();
					expect(screen.getByText("· times in Asia/Kolkata")).toBeDefined();
				}),
			);

			const backSelection = {
				grouping: "month",
				comparison: "none",
				range: { offset: -1, unit: "month", kind: "calendar" },
			} as const;
			const backSearch = reportingSearch(backSelection);
			backSearch.set("section", "contributor/activity");
			page.navigate(routeLocation("/v/k/analytics", `?${backSearch}`), {
				index: 0,
				key: "analytics-back",
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(screen.getByRole("combobox", { name: "Range: Previous month" })).toBeDefined();
					expect(screen.getByRole("combobox", { name: "Compare: Off" })).toBeDefined();
					expect(screen.getByRole("combobox", { name: "Group by: Month" })).toBeDefined();
				}),
			);

			const allTime = reportingSearch({
				grouping: "month",
				range: { kind: "all-time" },
				comparison: "previous-period",
			});
			page.navigate(routeLocation("/v/k/analytics", `?${allTime}`), {
				index: 1,
				key: "analytics-all-time",
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(screen.getByRole("combobox", { name: "Range: All time" })).toBeDefined();
					expect(
						screen.getByRole("combobox", { name: "Compare: Off" }).getAttribute("disabled"),
					).not.toBeNull();
					expect(screen.queryByText(/compared with/)).toBeNull();
					expect(
						screen.getByRole("combobox", { name: "Group by: Year" }).getAttribute("disabled"),
					).not.toBeNull();
				}),
			);
		}),
	testTimeout,
);

it.effect(
	"keeps the committed range and query input in sync across range history",
	() =>
		Effect.gen(function* () {
			const thirtyDaySelection: ReportingSelection = {
				grouping: "day",
				comparison: "previous-period",
				range: { days: 30, kind: "rolling" },
			};
			const sevenDaySelection: ReportingSelection = {
				...thirtyDaySelection,
				range: { days: 7, kind: "rolling" },
			};
			const thirtyDaySearch = `?${reportingSearch(thirtyDaySelection)}`;
			const sevenDaySearch = `?${reportingSearch(sevenDaySelection)}`;
			const page = mountPluginPage(AnalyticsPage, {
				page: context,
				catalogs: [sectionCatalog],
				analyticsSections: [
					{
						icon: "box",
						slug: "activity",
						load: () => Promise.resolve(RangeSection),
						ownerPluginId: PluginId.make("range-local"),
						name: { key: "section.range", namespace: "test-sections" },
					},
				],
			});
			page.navigate(routeLocation("/v/k/analytics", thirtyDaySearch));
			yield* Effect.promise(() => answerPreferences(page));
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(screen.getByRole("combobox", { name: "Range: Last 30 days" })).toBeDefined();
					expect(sectionRange()).toContain('"days":30');
				}),
			);
			const thirtyDayCaptions = periodCaptions();
			const thirtyDayRange = sectionRange();

			const previousUpdateCount = pageSearchUpdates(page).length;
			yield* choose("Range", "Last 7 days");
			yield* Effect.promise(() =>
				waitFor(() => expect(pageSearchUpdates(page).length).toBeGreaterThan(previousUpdateCount)),
			);
			const update = pageSearchUpdates(page).at(-1);
			expect(update?.mode).toBe("push");
			expect(update?.update).toMatchObject({ range: "rolling-7" });
			page.navigate(routeLocation("/v/k/analytics", sevenDaySearch), {
				index: 1,
				key: "analytics-seven-days",
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(screen.getByRole("combobox", { name: "Range: Last 7 days" })).toBeDefined();
					expect(sectionRange()).toContain('"days":7');
				}),
			);
			const sevenDayCaptions = periodCaptions();
			const sevenDayRange = sectionRange();

			page.navigate(routeLocation("/v/k/analytics", thirtyDaySearch), {
				index: 0,
				key: "analytics-thirty-days",
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(screen.getByRole("combobox", { name: "Range: Last 30 days" })).toBeDefined();
					expect(sectionRange()).toEqual(thirtyDayRange);
				}),
			);
			expect(periodCaptions()).toEqual(thirtyDayCaptions);

			page.navigate(routeLocation("/v/k/analytics", sevenDaySearch), {
				index: 1,
				key: "analytics-seven-days",
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(screen.getByRole("combobox", { name: "Range: Last 7 days" })).toBeDefined();
					expect(sectionRange()).toEqual(sevenDayRange);
				}),
			);
			expect(periodCaptions()).toEqual(sevenDayCaptions);
		}),
	testTimeout,
);

it.effect(
	"does not navigate for invalid custom dates and pushes valid dates only",
	() =>
		Effect.gen(function* () {
			const selection = {
				grouping: "day",
				comparison: "previous-period",
				range: { days: 30, kind: "rolling" },
			} as const;
			const search = reportingSearch(selection);
			search.set("section", "contributor/activity");
			const page = mountControls(`?${search}`);
			yield* Effect.promise(() => answerPreferences(page));
			yield* Effect.promise(() => screen.findByRole("combobox", { name: "Range: Last 30 days" }));
			const committedCaptions = periodCaptions();

			yield* choose("Range", "Custom dates");
			fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2025-03-02" } });
			fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2025-03-01" } });
			expect(pageSearchUpdates(page)).toHaveLength(0);
			expect(periodCaptions()).toEqual(committedCaptions);
			fireEvent.click(screen.getByRole("button", { name: "Apply dates" }));
			yield* Effect.promise(() => screen.findByRole("alert"));
			expect(pageSearchUpdates(page)).toHaveLength(0);
			expect(screen.getByDisplayValue("2025-03-02")).toBeDefined();
			expect(screen.getByDisplayValue("2025-03-01")).toBeDefined();
			expect(periodCaptions()).toEqual(committedCaptions);

			fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2025-03-04" } });
			expect(pageSearchUpdates(page)).toHaveLength(0);
			expect(periodCaptions()).toEqual(committedCaptions);
			fireEvent.click(screen.getByRole("button", { name: "Apply dates" }));
			yield* Effect.promise(() =>
				waitFor(() => {
					const update = pageSearchUpdates(page).at(-1);
					expect(update?.mode).toBe("push");
					expect(update?.update).toEqual({
						group: "day",
						range: "custom",
						end: "2025-03-04",
						start: "2025-03-02",
						compare: "previous-period",
					});
				}),
			);
		}),
	testTimeout,
);

it.effect(
	"discards custom date edits when history returns to committed URL selections",
	() =>
		Effect.gen(function* () {
			const rollingSelection: ReportingSelection = {
				grouping: "day",
				comparison: "previous-period",
				range: { days: 30, kind: "rolling" },
			};
			const customSelection: ReportingSelection = {
				...rollingSelection,
				range: { kind: "custom", endDate: "2025-03-04", startDate: "2025-03-02" },
			};
			const rollingSearch = `?${reportingSearch(rollingSelection)}`;
			const customSearch = `?${reportingSearch(customSelection)}`;
			const page = mountControls(rollingSearch);
			yield* Effect.promise(() => answerPreferences(page));
			yield* Effect.promise(() => screen.findByRole("combobox", { name: "Range: Last 30 days" }));

			page.navigate(routeLocation("/v/k/analytics", customSearch), {
				index: 1,
				key: "analytics-custom",
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(screen.getByRole("combobox", { name: "Range: Custom dates" })).toBeDefined();
					expect(screen.getByDisplayValue("2025-03-02")).toBeDefined();
					expect(screen.getByDisplayValue("2025-03-04")).toBeDefined();
				}),
			);
			const committedCaptions = periodCaptions();
			fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2025-04-10" } });
			fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2025-04-12" } });
			expect(screen.getByDisplayValue("2025-04-10")).toBeDefined();
			expect(screen.getByDisplayValue("2025-04-12")).toBeDefined();
			expect(periodCaptions()).toEqual(committedCaptions);
			expect(pageSearchUpdates(page)).toHaveLength(0);

			page.navigate(routeLocation("/v/k/analytics", rollingSearch), {
				index: 0,
				key: "analytics-thirty-days",
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(screen.getByRole("combobox", { name: "Range: Last 30 days" })).toBeDefined();
					expect(screen.queryByLabelText("Start date")).toBeNull();
				}),
			);

			page.navigate(routeLocation("/v/k/analytics", customSearch), {
				index: 1,
				key: "analytics-custom",
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(screen.getByRole("combobox", { name: "Range: Custom dates" })).toBeDefined();
					expect(screen.getByDisplayValue("2025-03-02")).toBeDefined();
					expect(screen.getByDisplayValue("2025-03-04")).toBeDefined();
				}),
			);
			expect(periodCaptions()).toEqual(committedCaptions);
		}),
	testTimeout,
);

it.effect(
	"pushes comparison, grouping, and section choices through page search",
	() =>
		Effect.gen(function* () {
			const selection = {
				grouping: "auto",
				comparison: "none",
				range: { days: 30, kind: "rolling" },
			} as const;
			const search = reportingSearch(selection);
			const firstSection = analyticsSectionKey({
				slug: "activity",
				ownerPluginId: PluginId.make("first-local"),
			});
			const secondSection = analyticsSectionKey({
				slug: "activity",
				ownerPluginId: PluginId.make("second-local"),
			});
			search.set("section", firstSection);
			const page = mountPluginPage(AnalyticsPage, {
				page: context,
				catalogs: [sectionCatalog],
				analyticsSections: [
					{
						load: null,
						icon: "box",
						slug: "activity",
						ownerPluginId: PluginId.make("first-local"),
						name: { key: "section.first", namespace: "test-sections" },
					},
					{
						load: null,
						icon: "box",
						slug: "activity",
						ownerPluginId: PluginId.make("second-local"),
						name: { key: "section.second", namespace: "test-sections" },
					},
				],
			});
			page.navigate(routeLocation("/v/k/analytics", `?${search}`));
			yield* Effect.promise(() => answerPreferences(page));
			yield* Effect.promise(() => screen.findByRole("combobox", { name: "Compare: Off" }));

			yield* choose("Compare", "Previous period");
			yield* Effect.promise(() =>
				waitFor(() => {
					const update = pageSearchUpdates(page).at(-1);
					expect(update?.mode).toBe("push");
					expect(update?.update).toEqual({
						end: null,
						start: null,
						group: "auto",
						range: "rolling-30",
						compare: "previous-period",
					});
					search.set("compare", "previous-period");
					page.navigate(routeLocation("/v/k/analytics", `?${search}`), {
						index: 1,
						key: "analytics-comparison",
					});
				}),
			);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("combobox", { name: "Compare: Previous period" })).toBeDefined(),
				),
			);

			yield* choose("Group by", "Month");
			yield* Effect.promise(() =>
				waitFor(() => {
					const update = pageSearchUpdates(page).at(-1);
					expect(update?.mode).toBe("push");
					expect(update?.update).toMatchObject({ group: "month", compare: "previous-period" });
				}),
			);

			fireEvent.click(screen.getByRole("radio", { name: "Second" }));
			yield* Effect.promise(() =>
				waitFor(() => {
					const update = pageSearchUpdates(page).at(-1);
					expect(update?.mode).toBe("push");
					expect(update?.update).toEqual({ section: secondSection });
				}),
			);
		}),
	testTimeout,
);
