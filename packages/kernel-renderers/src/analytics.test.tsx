import { afterEach, expect, it } from "@effect/vitest";
import { PluginId } from "@ryot-app/contract/schema/brands";
import type { ClientPageContext } from "@ryot-app/plugin-client-contract";
import {
	analyticsSectionKey,
	type AnalyticsSectionProps,
	type ReportingSelection,
	reportingSelectionSearch,
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

const FixtureSection = ({ owner, timeZone, selection }: AnalyticsSectionProps) => (
	<p>
		{owner.pluginId} / {selection.range.kind} / {timeZone}
	</p>
);

const pageSearchUpdates = (page: ReturnType<typeof mountPluginPage>) =>
	page.clientMessages().flatMap((message) => (message.type === "page-search" ? [message] : []));

const periodCaptions = () => {
	const controls = screen.getByRole("region", { name: "Analytics controls" });
	return {
		current: within(controls).getByText(/^Current period:/).textContent,
		previous: within(controls).getByText(/^Previous period:/).textContent,
	};
};

const reviewQueryWhere = (page: ReturnType<typeof mountPluginPage>, index: number) => {
	const request = page.queryRequests("reviews")[index];
	if (!request) {
		throw new Error("Missing collection review query");
	}
	return request.document.queries.reviews?.where;
};

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
				expect(screen.getByText("Reporting time zone: UTC")).toBeDefined();
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
				expect(alert.textContent).toContain("Reporting preferences refresh failed.");
				expect(alert.textContent).toContain("The last loaded time zone, UTC, is being used.");
				expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
				expect(screen.getByText("Reporting time zone: UTC")).toBeDefined();
				expect(screen.getByText("first-local / rolling / UTC")).toBeDefined();
			}),
		);

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
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
				expect(screen.getByText("Reporting time zone: Asia/Kolkata")).toBeDefined();
				expect(screen.getByText("first-local / rolling / Asia/Kolkata")).toBeDefined();
			}),
		);
	}),
);

const choose = (label: string, choice: string) =>
	Effect.gen(function* () {
		fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
		fireEvent.click(yield* Effect.promise(() => screen.findByRole("radio", { name: choice })));
		yield* Effect.promise(() =>
			waitFor(() => expect(screen.queryByRole("dialog", { name: label })).toBeNull()),
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
			const search = new URLSearchParams(
				reportingSelectionSearch({
					grouping: "year",
					comparison: "none",
					range: { kind: "all-time" },
				}),
			);
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
			expect(page.queryRequests("reviews")).toHaveLength(0);
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
			fireEvent.click(screen.getByRole("button", { name: "Collection reviews" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(pageSearchUpdates(page).at(-1)).toMatchObject({
						mode: "push",
						update: { section: null },
					}),
				),
			);
			page.navigate(routeLocation("/v/k/analytics"), { index: 2, key: "kernel-section" });
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Collection reviews" }));
			expect(screen.queryByText("first-local / rolling / Europe/Paris")).toBeNull();
			yield* Effect.promise(() =>
				waitFor(() => expect(page.queryRequests("reviews")).toHaveLength(1)),
			);
			page.navigate(routeLocation("/v/k/analytics", `?${firstSearch}`), {
				index: 1,
				key: "first-section",
			});
			yield* Effect.promise(() => screen.findByText("first-local / rolling / Europe/Paris"));
			expect(screen.queryByRole("heading", { name: "Collection reviews" })).toBeNull();
		}),
);

it.effect(
	"renders kernel collection reviews with effective preferences and zero plugin contributors",
	() =>
		Effect.gen(function* () {
			const page = mountPluginPage(AnalyticsPage, { page: context });
			page.navigate(routeLocation("/v/k/analytics"));
			yield* Effect.promise(() => answerPreferences(page));
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Collection reviews" }));
			expect(screen.getByText(/Includes rating-only reviews/).textContent).toContain(
				"Asia/Kolkata",
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(page.queryRequests("reviews")).toHaveLength(1)),
			);
			const records = page.queryRequests("reviews")[0];
			if (!records) {
				throw new Error("Missing collection records request");
			}
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
			yield* Effect.promise(() => screen.findByText("No collection reviews in this period."));
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
		const firstSearch = new URLSearchParams(reportingSelectionSearch(firstSelection));
		firstSearch.set("section", "contributor/activity");
		const page = mountControls(`?${firstSearch}`);
		yield* Effect.promise(() => answerPreferences(page));
		yield* Effect.promise(() =>
			waitFor(() => {
				expect(screen.getByRole("button", { name: "Date range: Last 90 days" })).toBeDefined();
				expect(screen.getByRole("button", { name: "Compare with: Previous period" })).toBeDefined();
				expect(screen.getByRole("button", { name: "Group by: Week" })).toBeDefined();
				expect(screen.getByText("Reporting time zone: Asia/Kolkata")).toBeDefined();
			}),
		);

		const backSelection = {
			grouping: "month",
			comparison: "none",
			range: { offset: -1, unit: "month", kind: "calendar" },
		} as const;
		const backSearch = new URLSearchParams(reportingSelectionSearch(backSelection));
		backSearch.set("section", "contributor/activity");
		page.navigate(routeLocation("/v/k/analytics", `?${backSearch}`), {
			index: 0,
			key: "analytics-back",
		});
		yield* Effect.promise(() =>
			waitFor(() => {
				expect(screen.getByRole("button", { name: "Date range: Previous month" })).toBeDefined();
				expect(screen.getByRole("button", { name: "Compare with: None" })).toBeDefined();
				expect(screen.getByRole("button", { name: "Group by: Month" })).toBeDefined();
			}),
		);

		const allTime = new URLSearchParams(
			reportingSelectionSearch({
				grouping: "year",
				range: { kind: "all-time" },
				comparison: "previous-period",
			}),
		);
		page.navigate(routeLocation("/v/k/analytics", `?${allTime}`), {
			index: 1,
			key: "analytics-all-time",
		});
		yield* Effect.promise(() =>
			waitFor(() => {
				expect(screen.getByRole("button", { name: "Date range: All time" })).toBeDefined();
				expect(
					screen.getByRole("button", { name: "Compare with: None" }).getAttribute("disabled"),
				).not.toBeNull();
				expect(screen.getByText("No comparison for all time.")).toBeDefined();
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
		const thirtyDaySearch = `?${reportingSelectionSearch(thirtyDaySelection)}`;
		const sevenDaySearch = `?${reportingSelectionSearch(sevenDaySelection)}`;
		const page = mountControls(thirtyDaySearch);
		yield* Effect.promise(() => answerPreferences(page));
		yield* Effect.promise(() =>
			waitFor(() => {
				expect(screen.getByRole("button", { name: "Date range: Last 30 days" })).toBeDefined();
				expect(page.queryRequests("reviews").length).toBeGreaterThan(0);
			}),
		);
		const thirtyDayCaptions = periodCaptions();
		const thirtyDayWhere = reviewQueryWhere(page, 0);
		expect(thirtyDayWhere).toBeDefined();

		const previousUpdateCount = pageSearchUpdates(page).length;
		yield* choose("Date range", "Last 7 days");
		yield* Effect.promise(() =>
			waitFor(() => expect(pageSearchUpdates(page).length).toBeGreaterThan(previousUpdateCount)),
		);
		const update = pageSearchUpdates(page).at(-1);
		expect(update?.mode).toBe("push");
		expect(typeof update?.update["reporting"]).toBe("string");
		page.navigate(routeLocation("/v/k/analytics", sevenDaySearch), {
			index: 1,
			key: "analytics-seven-days",
		});
		yield* Effect.promise(() =>
			waitFor(() => {
				expect(screen.getByRole("button", { name: "Date range: Last 7 days" })).toBeDefined();
				expect(page.queryRequests("reviews").length).toBeGreaterThan(1);
			}),
		);
		const sevenDayCaptions = periodCaptions();
		const sevenDayWhere = reviewQueryWhere(page, 1);
		expect(sevenDayWhere).toBeDefined();
		expect(sevenDayWhere).not.toEqual(thirtyDayWhere);

		page.navigate(routeLocation("/v/k/analytics", thirtyDaySearch), {
			index: 0,
			key: "analytics-thirty-days",
		});
		yield* Effect.promise(() =>
			waitFor(() =>
				expect(screen.getByRole("button", { name: "Date range: Last 30 days" })).toBeDefined(),
			),
		);
		expect(periodCaptions()).toEqual(thirtyDayCaptions);
		expect(reviewQueryWhere(page, 0)).toEqual(thirtyDayWhere);

		page.navigate(routeLocation("/v/k/analytics", sevenDaySearch), {
			index: 1,
			key: "analytics-seven-days",
		});
		yield* Effect.promise(() =>
			waitFor(() =>
				expect(screen.getByRole("button", { name: "Date range: Last 7 days" })).toBeDefined(),
			),
		);
		expect(periodCaptions()).toEqual(sevenDayCaptions);
		expect(reviewQueryWhere(page, 1)).toEqual(sevenDayWhere);
	}),
);

it.effect("does not navigate for invalid custom dates and pushes valid dates only", () =>
	Effect.gen(function* () {
		const selection = {
			grouping: "day",
			comparison: "previous-period",
			range: { days: 30, kind: "rolling" },
		} as const;
		const search = new URLSearchParams(reportingSelectionSearch(selection));
		search.set("section", "contributor/activity");
		const page = mountControls(`?${search}`);
		yield* Effect.promise(() => answerPreferences(page));
		yield* Effect.promise(() => screen.findByRole("button", { name: "Date range: Last 30 days" }));
		const committedCaptions = periodCaptions();

		yield* choose("Date range", "Custom dates");
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
				expect(Object.keys(update?.update ?? {})).toEqual(["reporting"]);
				const reporting = update?.update["reporting"];
				expect(typeof reporting).toBe("string");
				if (typeof reporting === "string") {
					expect(JSON.parse(reporting)).toEqual({
						grouping: "day",
						comparison: "previous-period",
						range: { kind: "custom", endDate: "2025-03-04", startDate: "2025-03-02" },
					});
				}
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
		const rollingSearch = `?${reportingSelectionSearch(rollingSelection)}`;
		const customSearch = `?${reportingSelectionSearch(customSelection)}`;
		const page = mountControls(rollingSearch);
		yield* Effect.promise(() => answerPreferences(page));
		yield* Effect.promise(() => screen.findByRole("button", { name: "Date range: Last 30 days" }));

		page.navigate(routeLocation("/v/k/analytics", customSearch), {
			index: 1,
			key: "analytics-custom",
		});
		yield* Effect.promise(() =>
			waitFor(() => {
				expect(screen.getByRole("button", { name: "Date range: Custom dates" })).toBeDefined();
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
				expect(screen.getByRole("button", { name: "Date range: Last 30 days" })).toBeDefined();
				expect(screen.queryByLabelText("Start date")).toBeNull();
			}),
		);

		page.navigate(routeLocation("/v/k/analytics", customSearch), {
			index: 1,
			key: "analytics-custom",
		});
		yield* Effect.promise(() =>
			waitFor(() => {
				expect(screen.getByRole("button", { name: "Date range: Custom dates" })).toBeDefined();
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
		const search = new URLSearchParams(reportingSelectionSearch(selection));
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
		yield* Effect.promise(() => screen.findByRole("button", { name: "Compare with: None" }));

		yield* choose("Compare with", "Previous period");
		yield* Effect.promise(() =>
			waitFor(() => {
				const update = pageSearchUpdates(page).at(-1);
				expect(update?.mode).toBe("push");
				expect(Object.keys(update?.update ?? {})).toEqual(["reporting"]);
				const reporting = update?.update["reporting"];
				expect(typeof reporting).toBe("string");
				if (typeof reporting === "string") {
					expect(JSON.parse(reporting)).toEqual({
						grouping: "auto",
						comparison: "previous-period",
						range: { days: 30, kind: "rolling" },
					});
					search.set("reporting", reporting);
					page.navigate(routeLocation("/v/k/analytics", `?${search}`), {
						index: 1,
						key: "analytics-comparison",
					});
				}
			}),
		);
		yield* Effect.promise(() =>
			waitFor(() =>
				expect(screen.getByRole("button", { name: "Compare with: Previous period" })).toBeDefined(),
			),
		);

		yield* choose("Group by", "Month");
		yield* Effect.promise(() =>
			waitFor(() => {
				const update = pageSearchUpdates(page).at(-1);
				expect(update?.mode).toBe("push");
				expect(Object.keys(update?.update ?? {})).toEqual(["reporting"]);
				const reporting = update?.update["reporting"];
				expect(typeof reporting).toBe("string");
				if (typeof reporting === "string") {
					expect(JSON.parse(reporting)).toEqual({
						grouping: "month",
						comparison: "previous-period",
						range: { days: 30, kind: "rolling" },
					});
					search.set("reporting", reporting);
					page.navigate(routeLocation("/v/k/analytics", `?${search}`), {
						index: 2,
						key: "analytics-grouping",
					});
				}
			}),
		);

		fireEvent.click(screen.getByRole("button", { name: "Second" }));
		yield* Effect.promise(() =>
			waitFor(() => {
				const update = pageSearchUpdates(page).at(-1);
				expect(update?.mode).toBe("push");
				expect(update?.update).toEqual({ section: secondSection });
			}),
		);
	}),
);
