// @vitest-environment jsdom

import { fireEvent, waitFor } from "@testing-library/dom";
import { useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { decodeShowActivity } from "../../tests/client/show/activity-fixture";
import {
	decodeShowEpisodesResult,
	decodeShowSeasonEpisodesResult,
} from "../../tests/client/show/episodes-fixture";
import {
	decodeShowOverview,
	emptyShowOverview,
	showCompanyRow,
	showPersonRow,
} from "../../tests/client/show/overview-fixture";
import {
	errorQueryResult,
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
} from "../../tests/client/show/query-result-fixture";
import { decodeShowSummaryResult, showSummaryRow } from "../../tests/client/show/summary-fixture";
import { mountRyotClient } from "../../tests/client/show/test-support";
import { ShowActivity } from "./activity";
import { mapShowActivity, type ShowActivityState } from "./activity-state";
import { ShowEpisodes } from "./episodes";
import { mapShowEpisodes, mapShowSeasonEpisodes, type ShowEpisodesState } from "./episodes-state";
import { mapShowOverview, type ShowOverviewState } from "./overview-state";
import { ShowScreenBody } from "./screen";
import { mapShowSummary, type ShowSummaryState } from "./summary-state";

const noopAdapter = { query: () => Promise.resolve({}) };

const overviewState = (rows: Parameters<typeof decodeShowOverview>[0] = {}): ShowOverviewState =>
	mapShowOverview(readyQueryResult(decodeShowOverview(rows)));

const episodesState = (): ShowEpisodesState =>
	mapShowEpisodes(readyQueryResult(decodeShowEpisodesResult({})));

const activityState = (): ShowActivityState =>
	mapShowActivity(readyQueryResult(decodeShowActivity()));

function EpisodesTabProbe(props: { readonly onLoad: () => void }) {
	const { onLoad } = props;
	useEffect(() => {
		onLoad();
	}, [onLoad]);
	return (
		<ShowEpisodes
			compact
			selectedId={null}
			state={episodesState()}
			onSelect={() => undefined}
			refresh={() => undefined}
			onRefreshSeason={() => undefined}
			seasonEpisodes={mapShowSeasonEpisodes(readyQueryResult(decodeShowSeasonEpisodesResult({})))}
		/>
	);
}

function ActivityTabProbe(props: { readonly onLoad: () => void }) {
	const { onLoad } = props;
	useEffect(() => {
		onLoad();
	}, [onLoad]);
	return <ShowActivity compact state={activityState()} refresh={() => undefined} />;
}

const readyState = (overrides: Record<string, unknown> = {}): ShowSummaryState =>
	mapShowSummary(
		readyQueryResult(
			decodeShowSummaryResult({
				requested: [{ schemaSlug: "show" }],
				show: [{ ...showSummaryRow, ...overrides }],
			}),
		),
	);

const unavailableState = (requested: readonly Record<string, unknown>[]): ShowSummaryState =>
	mapShowSummary(readyQueryResult(decodeShowSummaryResult({ requested, show: [] })));

const renderContent = (
	state: ShowSummaryState,
	options: {
		readonly compact?: boolean;
		readonly episodes?: ReactNode;
		readonly activity?: ReactNode;
		readonly refresh?: () => void;
		readonly overview?: ShowOverviewState;
		readonly refreshOverview?: () => void;
	} = {},
) =>
	mountRyotClient(
		noopAdapter,
		<ShowScreenBody
			state={state}
			settled={undefined}
			compact={options.compact ?? true}
			refresh={options.refresh ?? (() => undefined)}
			overview={options.overview ?? overviewState()}
			refreshOverview={options.refreshOverview ?? (() => undefined)}
			episodes={options.episodes ?? <EpisodesTabProbe onLoad={() => undefined} />}
			activity={options.activity ?? <ActivityTabProbe onLoad={() => undefined} />}
		/>,
	);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("show screen content", () => {
	it("renders the loading branch while the summary query is pending", () => {
		const { container, unmount } = renderContent(mapShowSummary(pendingQueryResult()));

		expect(container.textContent).toContain("Loading show...");
		expect(container.querySelector('[role="tab"]')).toBeNull();
		unmount();
	});

	it("offers a retry from the transport error branch", () => {
		const retries: number[] = [];
		const { container, unmount } = renderContent(
			mapShowSummary(errorQueryResult(new Error("offline"))),
			{ refresh: () => retries.push(1) },
		);

		const retry = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Try again",
		);
		if (retry === undefined) {
			throw new Error("Expected the show retry button");
		}
		fireEvent.click(retry);

		expect(container.textContent).toContain("Unable to load this show");
		expect(retries).toEqual([1]);
		unmount();
	});

	it("renders a stable message for a malformed summary response", () => {
		const { container, unmount } = renderContent(mapShowSummary(malformedQueryResult()));

		expect(container.textContent).toContain("Unable to display this show");
		unmount();
	});

	it("renders the unavailable branch for a missing entity", () => {
		const { container, unmount } = renderContent(unavailableState([]));

		expect(container.textContent).toContain("Show unavailable");
		expect(container.textContent).toContain("This entity no longer exists.");
		unmount();
	});

	it("renders the unavailable branch for a non-show entity", () => {
		const { container, unmount } = renderContent(unavailableState([{ schemaSlug: "book" }]));

		expect(container.textContent).toContain("Show unavailable");
		expect(container.textContent).toContain(
			"This entity is not a show, and only shows can be opened here.",
		);
		unmount();
	});

	it("renders decoded show values in the summary header and overview", () => {
		const { container, unmount } = renderContent(readyState());

		expect(container.textContent).toContain("Adolescence");
		expect(container.textContent).toContain("TMDB");
		expect(container.textContent).toContain("Drama");
		expect(container.textContent).toContain("Ended");
		expect(container.textContent).toContain("A four-part limited series.");
		expect(container.textContent).not.toContain("show-1");
		unmount();
	});

	it("renders library, ownership, collection and status facts in the rail", () => {
		const { container, unmount } = renderContent(readyState());

		expect(container.textContent).toContain("In library");
		expect(container.textContent).toContain("Ownership");
		expect(container.textContent).toContain("Not recorded");
		expect(container.textContent).toContain("Collections");
		expect(container.textContent).toContain("1 collection");
		expect(container.textContent).toContain("Your status");
		expect(container.textContent).toContain("Complete");
		expect(
			Array.from(container.querySelectorAll("button")).some(
				(button) => button.textContent === "Manage",
			),
		).toBe(true);
		unmount();
	});

	it("drops the row and fact icons the wide layout does not need", () => {
		const compact = renderContent(readyState());
		const compactIcons = compact.container.querySelectorAll("svg").length;
		compact.unmount();

		const { container, unmount } = renderContent(readyState(), { compact: false });

		expect(compactIcons).toBe(container.querySelectorAll("svg").length + 9);
		expect(container.textContent).toContain("In library");
		expect(container.textContent).toContain("Production status");
		unmount();
	});

	it("explains an empty collection membership in the rail", () => {
		const { container, unmount } = renderContent(
			readyState({ collections: { pageInfo: { hasMore: false, limit: 6 }, items: [] } }),
		);

		expect(container.textContent).toContain("Not in any collection");
		expect(container.textContent).not.toContain("1 collection");
		unmount();
	});

	it("omits summary values that the provider did not record", () => {
		const { container, unmount } = renderContent(
			readyState({
				genres: null,
				description: null,
				publishYear: null,
				publishDate: null,
				providerName: null,
				totalSeasons: null,
				totalEpisodes: null,
				providerRating: null,
				productionStatus: null,
			}),
		);

		expect(container.textContent).toContain("TV Show");
		expect(container.textContent).not.toContain("TMDB");
		expect(container.textContent).not.toContain("A four-part limited series.");
		expect(container.textContent).not.toContain("Provider rating");
		expect(container.textContent).not.toContain("Production status");
		unmount();
	});

	it("keeps Overview selected and leaves state unchanged for deferred controls", () => {
		const { container, unmount } = renderContent(readyState());
		const monitoring = container.querySelector('[aria-label="Toggle media monitoring"]');
		const logActivity = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Log activity",
		);
		if (monitoring === null || logActivity === undefined) {
			throw new Error("Expected the monitoring switch and Log activity button");
		}

		fireEvent.click(monitoring);
		fireEvent.click(logActivity);

		const overviewTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
			(tab) => tab.textContent === "Overview",
		);
		const activityTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
			(tab) => tab.textContent === "Activity",
		);
		expect(overviewTab?.getAttribute("aria-selected")).toBe("true");
		expect(activityTab?.getAttribute("aria-selected")).toBe("false");
		unmount();
	});

	it("loads the activity tab only once it is selected", async () => {
		const loads: number[] = [];
		const { container, unmount } = renderContent(readyState(), {
			activity: <ActivityTabProbe onLoad={() => loads.push(1)} />,
		});

		expect(loads).toEqual([]);

		const activityTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
			(tab) => tab.textContent === "Activity",
		);
		if (activityTab === undefined) {
			throw new Error("Expected the Activity tab");
		}
		fireEvent.click(activityTab);

		await waitFor(() => expect(loads).toEqual([1]));
		expect(activityTab.getAttribute("aria-selected")).toBe("true");
		expect(container.textContent).toContain("Adolescence");
		expect(container.textContent).toContain("Finished the show");
		expect(container.textContent).not.toContain("Cast & crew");
		unmount();
	});

	it("keeps the summary and the other tabs when the activity query fails", async () => {
		const { container, unmount } = renderContent(readyState(), {
			activity: (
				<ShowActivity
					compact
					refresh={() => undefined}
					state={mapShowActivity(errorQueryResult(new Error("offline")))}
				/>
			),
		});

		const activityTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
			(tab) => tab.textContent === "Activity",
		);
		if (activityTab === undefined) {
			throw new Error("Expected the Activity tab");
		}
		fireEvent.click(activityTab);

		expect(container.textContent).toContain("Adolescence");
		await waitFor(() => expect(container.textContent).toContain("Unable to load activity"));
		expect(
			Array.from(container.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent),
		).toEqual(["Overview", "Episodes", "Activity"]);
		unmount();
	});

	it("loads the episodes tab only once it is selected", async () => {
		const loads: number[] = [];
		const { container, unmount } = renderContent(readyState(), {
			episodes: <EpisodesTabProbe onLoad={() => loads.push(1)} />,
		});

		expect(loads).toEqual([]);
		expect(container.textContent).toContain("Cast & crew");

		const episodesTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
			(tab) => tab.textContent === "Episodes",
		);
		if (episodesTab === undefined) {
			throw new Error("Expected the Episodes tab");
		}
		fireEvent.click(episodesTab);

		await waitFor(() => expect(loads).toEqual([1]));
		expect(episodesTab.getAttribute("aria-selected")).toBe("true");
		expect(container.textContent).toContain("Adolescence");
		expect(container.textContent).toContain("Episode 1: The Arrest");
		expect(container.textContent).not.toContain("Cast & crew");
		unmount();
	});

	it("returns to the preserved overview after visiting episodes", () => {
		const { container, unmount } = renderContent(readyState());
		const tab = (name: string) => {
			const element = Array.from(container.querySelectorAll('[role="tab"]')).find(
				(candidate) => candidate.textContent === name,
			);
			if (element === undefined) {
				throw new Error(`Expected the ${name} tab`);
			}
			return element;
		};

		fireEvent.click(tab("Episodes"));
		fireEvent.click(tab("Overview"));

		expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
		expect(container.textContent).toContain("Cast & crew");
		expect(container.textContent).toContain("Owen Cooper");
		expect(container.textContent).not.toContain("Episode 1: The Arrest");
		unmount();
	});

	it("expands and re-clamps the description from the header", async () => {
		const { container, unmount } = renderContent(readyState());
		const description = () =>
			Array.from(container.querySelectorAll("p")).find(
				(paragraph) => paragraph.textContent === "A four-part limited series.",
			);

		expect(description()?.className).toContain("line-clamp-3");

		const more = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "More",
		);
		if (more === undefined) {
			throw new Error("Expected the More button");
		}
		fireEvent.click(more);

		await waitFor(() => expect(description()?.className).not.toContain("line-clamp-3"));

		const less = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Less",
		);
		if (less === undefined) {
			throw new Error("Expected the Less button");
		}
		fireEvent.click(less);

		await waitFor(() => expect(description()?.className).toContain("line-clamp-3"));
		unmount();
	});

	it("renders images, credits, companies and recommendations in the overview", () => {
		const { container, unmount } = renderContent(readyState());

		expect(container.textContent).toContain("Images");
		expect(container.textContent).toContain("Cast & crew");
		expect(container.textContent).toContain("Owen Cooper");
		expect(container.textContent).toContain("Actor, Guest Star");
		expect(container.textContent).toContain("as Jamie");
		expect(container.textContent).toContain("Production companies");
		expect(container.textContent).toContain("Warp Films");
		expect(container.textContent).toContain("Production Company");
		expect(container.textContent).toContain("More like this");
		expect(container.textContent).toContain("Bad Girls");
		unmount();
	});

	it("omits credit detail that the provider did not record", () => {
		const { container, unmount } = renderContent(readyState(), {
			overview: overviewState({
				companies: [{ ...showCompanyRow, roles: null }],
				people: [{ ...showPersonRow, roles: [], character: null }],
			}),
		});

		expect(container.textContent).toContain("Owen Cooper");
		expect(container.textContent).toContain("Warp Films");
		expect(container.textContent).not.toContain("as Jamie");
		expect(container.textContent).not.toContain("Actor, Guest Star");
		expect(container.textContent).not.toContain("Production Company");
		unmount();
	});

	it("omits overview sections that hold no relationships", () => {
		const { container, unmount } = renderContent(readyState(), {
			overview: overviewState({ people: [], recommendations: [] }),
		});

		expect(container.textContent).toContain("Production companies");
		expect(container.textContent).not.toContain("Cast & crew");
		expect(container.textContent).not.toContain("More like this");
		unmount();
	});

	it("renders nothing relational when the show has no credits or suggestions", () => {
		const { container, unmount } = renderContent(readyState(), {
			overview: mapShowOverview(readyQueryResult(emptyShowOverview())),
		});

		expect(container.textContent).toContain("Images");
		expect(container.textContent).not.toContain("Cast & crew");
		expect(container.textContent).not.toContain("Production companies");
		expect(container.textContent).not.toContain("More like this");
		unmount();
	});

	it("links each recommendation to its own entity route", () => {
		const { container, unmount } = renderContent(readyState());

		const link = Array.from(container.querySelectorAll("a")).find(
			(anchor) => anchor.getAttribute("aria-label") === "Open Bad Girls",
		);
		expect(link?.getAttribute("href")).toContain("show-2");
		unmount();
	});

	it("keeps the summary hero readable while the overview query is pending", () => {
		const { container, unmount } = renderContent(readyState(), {
			overview: mapShowOverview(pendingQueryResult()),
		});

		expect(container.textContent).toContain("Adolescence");
		expect(container.textContent).toContain("Loading details...");
		expect(container.textContent).not.toContain("Cast & crew");
		unmount();
	});

	it("keeps the summary hero readable and offers a retry when the overview fails", () => {
		const retries: number[] = [];
		const { container, unmount } = renderContent(readyState(), {
			refreshOverview: () => retries.push(1),
			overview: mapShowOverview(errorQueryResult(new Error("offline"))),
		});

		const retry = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Try again",
		);
		if (retry === undefined) {
			throw new Error("Expected the overview retry button");
		}
		fireEvent.click(retry);

		expect(container.textContent).toContain("Adolescence");
		expect(container.textContent).toContain("Images");
		expect(container.textContent).toContain("Unable to load these details");
		expect(retries).toEqual([1]);
		unmount();
	});
});
