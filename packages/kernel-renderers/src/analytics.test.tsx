import { afterEach, expect, it } from "@effect/vitest";
import { PluginId } from "@ryot-app/contract/schema/brands";
import type { ClientPageContext } from "@ryot-app/plugin-client-contract";
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
} from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { Effect } from "effect";

import AnalyticsPage from "./analytics";

afterEach(() => {
	disposePluginBridges();
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

const answerPreferences = (page: ReturnType<typeof mountPluginPage>) =>
	waitFor(() => {
		const request = page
			.clientMessages()
			.find((message) => message.type === "reporting-preferences-request");
		if (!request) {
			throw new Error("No reporting request");
		}
		page.send({
			outcome: "success",
			requestId: request.requestId,
			type: "reporting-preferences-result",
			preferences: { timeZone: TimeZone.make("Asia/Kolkata") },
		});
	});

const answerReportingPreferences = (
	page: ReturnType<typeof mountPluginPage>,
	requestNumber: number,
	result:
		| { readonly outcome: "failure"; readonly reason: "transport" }
		| { readonly outcome: "success"; readonly preferences: { readonly timeZone: TimeZone } },
) =>
	waitFor(() => {
		const request = page
			.clientMessages()
			.filter((message) => message.type === "reporting-preferences-request")[requestNumber - 1];
		if (!request) {
			throw new Error("No reporting preferences request");
		}
		page.send({ ...result, requestId: request.requestId, type: "reporting-preferences-result" });
	});

const mountControls = (search: string) => {
	const page = mountPluginPage(AnalyticsPage, { page: context });
	page.navigate(routeLocation("/v/k/analytics", search));
	return page;
};

it.effect("retains loaded analytics with an error when reporting preferences refresh fails", () =>
	Effect.gen(function* () {
		let attempts = 0;
		const section = { slug: "activity", ownerPluginId: PluginId.make("first-local") };
		const search = new URLSearchParams();
		search.set("section", analyticsSectionKey(section));
		const page = mountPluginPage(AnalyticsPage, {
			page: context,
			analyticsSections: [
				{ icon: "box", name: "Activity", ...section, load: () => Promise.resolve(FixtureSection) },
			],
			onClientMessage: (message) => {
				if (message.type === "reporting-preferences-request") {
					attempts += 1;
				}
			},
		});
		page.navigate(routeLocation("/v/k/analytics", `?${search}`));
		yield* Effect.promise(() =>
			answerReportingPreferences(page, 1, {
				outcome: "success",
				preferences: { timeZone: TimeZone.make("UTC") },
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
			answerReportingPreferences(page, 2, { outcome: "failure", reason: "transport" }),
		);
		yield* Effect.promise(() =>
			waitFor(() => {
				expect(attempts).toBe(2);
				const alert = screen.getByRole("alert");
				expect(alert.textContent).toContain(
					"Could not update reporting preferences. Showing the last loaded values.",
				);
				expect(screen.getByText("· times in UTC")).toBeDefined();
				expect(screen.getByText("first-local / rolling / UTC")).toBeDefined();
			}),
		);

		fireEvent.click(screen.getByRole("button", { name: "Retry reporting preferences" }));
		yield* Effect.promise(() =>
			answerReportingPreferences(page, 3, {
				outcome: "success",
				preferences: { timeZone: TimeZone.make("Asia/Kolkata") },
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
);

const choose = (label: string, choice: string) =>
	Effect.gen(function* () {
		fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
		fireEvent.click(
			yield* Effect.promise(() => screen.findByRole("menuitemradio", { name: choice })),
		);
		yield* Effect.promise(() =>
			waitFor(() => expect(screen.queryByRole("menu", { name: label })).toBeNull()),
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
				analyticsSections: [
					{
						icon: "box",
						name: "First",
						slug: "activity",
						ownerPluginId: PluginId.make("first-local"),
						load: () => {
							loaded.push("first");
							return Promise.resolve(FixtureSection);
						},
					},
					{
						icon: "box",
						name: "Second",
						slug: "activity",
						ownerPluginId: PluginId.make("second-local"),
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
						.find((message) => message.type === "reporting-preferences-request");
					if (!request) {
						throw new Error("No reporting request");
					}
					page.send({
						outcome: "success",
						requestId: request.requestId,
						type: "reporting-preferences-result",
						preferences: { timeZone: TimeZone.make("Europe/Paris") },
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
);

it.effect("selects the only contributor without section navigation for an absent section", () =>
	Effect.gen(function* () {
		const page = mountPluginPage(AnalyticsPage, {
			page: context,
			analyticsSections: [
				{
					icon: "box",
					name: "Only",
					slug: "activity",
					ownerPluginId: PluginId.make("only-local"),
					load: () => Promise.resolve(FixtureSection),
				},
			],
		});
		page.navigate(routeLocation("/v/k/analytics"));
		yield* Effect.promise(() => answerPreferences(page));
		yield* Effect.promise(() => screen.findByText("only-local / rolling / Asia/Kolkata"));
		expect(screen.queryByRole("radiogroup", { name: "Analytics sections" })).toBeNull();
	}),
);

it.effect("renders an empty state with effective preferences and zero plugin contributors", () =>
	Effect.gen(function* () {
		const page = mountPluginPage(AnalyticsPage, { page: context });
		page.navigate(routeLocation("/v/k/analytics"));
		yield* Effect.promise(() => answerPreferences(page));
		yield* Effect.promise(() => screen.findByText("No analytics available"));
		expect(screen.getByText("· times in Asia/Kolkata")).toBeDefined();
		expect(screen.getAllByRole("heading", { level: 1, name: "Analytics" })).toHaveLength(1);
	}),
);

it.effect("decodes controls from the URL and follows incoming history state", () =>
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
				expect(screen.getByRole("button", { name: "Range: Last 90 days" })).toBeDefined();
				expect(screen.getByRole("button", { name: "Compare: Previous period" })).toBeDefined();
				expect(screen.getByRole("button", { name: "Group by: Week" })).toBeDefined();
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
				expect(screen.getByRole("button", { name: "Range: Previous month" })).toBeDefined();
				expect(screen.getByRole("button", { name: "Compare: Off" })).toBeDefined();
				expect(screen.getByRole("button", { name: "Group by: Month" })).toBeDefined();
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
				expect(screen.getByRole("button", { name: "Range: All time" })).toBeDefined();
				expect(
					screen.getByRole("button", { name: "Compare: Off" }).getAttribute("disabled"),
				).not.toBeNull();
				expect(screen.queryByText(/compared with/)).toBeNull();
				expect(
					screen.getByRole("button", { name: "Group by: Year" }).getAttribute("disabled"),
				).not.toBeNull();
			}),
		);
	}),
);

it.effect("keeps the committed range and query input in sync across range history", () =>
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
			analyticsSections: [
				{
					icon: "box",
					name: "Range",
					slug: "activity",
					load: () => Promise.resolve(RangeSection),
					ownerPluginId: PluginId.make("range-local"),
				},
			],
		});
		page.navigate(routeLocation("/v/k/analytics", thirtyDaySearch));
		yield* Effect.promise(() => answerPreferences(page));
		yield* Effect.promise(() =>
			waitFor(() => {
				expect(screen.getByRole("button", { name: "Range: Last 30 days" })).toBeDefined();
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
				expect(screen.getByRole("button", { name: "Range: Last 7 days" })).toBeDefined();
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
				expect(screen.getByRole("button", { name: "Range: Last 30 days" })).toBeDefined();
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
				expect(screen.getByRole("button", { name: "Range: Last 7 days" })).toBeDefined();
				expect(sectionRange()).toEqual(sevenDayRange);
			}),
		);
		expect(periodCaptions()).toEqual(sevenDayCaptions);
	}),
);

it.effect("does not navigate for invalid custom dates and pushes valid dates only", () =>
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
		yield* Effect.promise(() => screen.findByRole("button", { name: "Range: Last 30 days" }));
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
);

it.effect("discards custom date edits when history returns to committed URL selections", () =>
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
		yield* Effect.promise(() => screen.findByRole("button", { name: "Range: Last 30 days" }));

		page.navigate(routeLocation("/v/k/analytics", customSearch), {
			index: 1,
			key: "analytics-custom",
		});
		yield* Effect.promise(() =>
			waitFor(() => {
				expect(screen.getByRole("button", { name: "Range: Custom dates" })).toBeDefined();
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
				expect(screen.getByRole("button", { name: "Range: Last 30 days" })).toBeDefined();
				expect(screen.queryByLabelText("Start date")).toBeNull();
			}),
		);

		page.navigate(routeLocation("/v/k/analytics", customSearch), {
			index: 1,
			key: "analytics-custom",
		});
		yield* Effect.promise(() =>
			waitFor(() => {
				expect(screen.getByRole("button", { name: "Range: Custom dates" })).toBeDefined();
				expect(screen.getByDisplayValue("2025-03-02")).toBeDefined();
				expect(screen.getByDisplayValue("2025-03-04")).toBeDefined();
			}),
		);
		expect(periodCaptions()).toEqual(committedCaptions);
	}),
);

it.effect("pushes comparison, grouping, and section choices through page search", () =>
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
			analyticsSections: [
				{
					load: null,
					icon: "box",
					name: "First",
					slug: "activity",
					ownerPluginId: PluginId.make("first-local"),
				},
				{
					load: null,
					icon: "box",
					name: "Second",
					slug: "activity",
					ownerPluginId: PluginId.make("second-local"),
				},
			],
		});
		page.navigate(routeLocation("/v/k/analytics", `?${search}`));
		yield* Effect.promise(() => answerPreferences(page));
		yield* Effect.promise(() => screen.findByRole("button", { name: "Compare: Off" }));

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
				expect(screen.getByRole("button", { name: "Compare: Previous period" })).toBeDefined(),
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
);
