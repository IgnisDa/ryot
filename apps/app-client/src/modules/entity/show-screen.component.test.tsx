import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, type ReactNode } from "react";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { ShowEpisodes } from "./show-episodes";
import { decodeShowEpisodesResult } from "./show-episodes-fixture";
import { mapShowEpisodes, type ShowEpisodesState } from "./show-episodes-state";
import {
	decodeShowOverview,
	emptyShowOverview,
	showCompanyRow,
	showPersonRow,
	showRecommendationRow,
} from "./show-overview-fixture";
import { mapShowOverview, type ShowOverviewState } from "./show-overview-state";
import { ShowScreenContent } from "./show-screen-content";
import { decodeShowSummaryResult, showSummaryRow } from "./show-summary-fixture";
import { mapShowSummary, type ShowSummaryState } from "./show-summary-state";

const description = () => screen.getByText("A four-part limited series.");

const overviewState = (rows: Parameters<typeof decodeShowOverview>[0] = {}): ShowOverviewState =>
	mapShowOverview(AsyncResult.success(decodeShowOverview(rows)));

const episodesState = (): ShowEpisodesState =>
	mapShowEpisodes(AsyncResult.success(decodeShowEpisodesResult({})));

function EpisodesTabProbe(props: { readonly onLoad: () => void }) {
	const { onLoad } = props;
	useEffect(() => {
		onLoad();
	}, [onLoad]);
	return <ShowEpisodes state={episodesState()} refresh={() => undefined} />;
}

const readyState = (overrides: Record<string, unknown> = {}): ShowSummaryState =>
	mapShowSummary(
		AsyncResult.success(
			decodeShowSummaryResult({
				requested: [{ schemaSlug: "show" }],
				show: [{ ...showSummaryRow, ...overrides }],
			}),
		),
	);

const unavailableState = (requested: readonly Record<string, unknown>[]): ShowSummaryState =>
	mapShowSummary(AsyncResult.success(decodeShowSummaryResult({ requested, show: [] })));

const renderContent = (
	state: ShowSummaryState,
	options: {
		readonly episodes?: ReactNode;
		readonly refresh?: () => void;
		readonly overview?: ShowOverviewState;
		readonly refreshOverview?: () => void;
	} = {},
) =>
	render(
		<ShowScreenContent
			state={state}
			refresh={options.refresh ?? (() => undefined)}
			overview={options.overview ?? overviewState()}
			refreshOverview={options.refreshOverview ?? (() => undefined)}
			episodes={options.episodes ?? <EpisodesTabProbe onLoad={() => undefined} />}
		/>,
	);

describe("show screen content", () => {
	it("renders the loading branch while the summary query is pending", async () => {
		await renderContent(mapShowSummary(AsyncResult.initial(true)));

		expect(screen.getByText("Loading show...")).toBeOnTheScreen();
		expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeOnTheScreen();
	});

	it("offers a retry from the transport error branch", async () => {
		const user = userEvent.setup();
		const retries: number[] = [];
		await renderContent(mapShowSummary(AsyncResult.failure(Cause.fail(new Error("offline")))), {
			refresh: () => retries.push(1),
		});

		await user.press(screen.getByRole("button", { name: "Try again" }));

		expect(screen.getByText("Unable to load this show")).toBeOnTheScreen();
		expect(retries).toEqual([1]);
	});

	it("renders a stable message for a malformed summary response", async () => {
		const cause = Cause.fail(new RyotQLMalformedResultError("bad row"));
		await renderContent(mapShowSummary(AsyncResult.failure(cause)));

		expect(screen.getByText("Unable to display this show")).toBeOnTheScreen();
		expect(screen.queryByText(/bad row/)).not.toBeOnTheScreen();
	});

	it("renders the unavailable branch for a missing entity", async () => {
		await renderContent(unavailableState([]));

		expect(screen.getByText("Show unavailable")).toBeOnTheScreen();
		expect(screen.getByText("This entity no longer exists.")).toBeOnTheScreen();
	});

	it("renders the unavailable branch for a non-show entity", async () => {
		await renderContent(unavailableState([{ schemaSlug: "book" }]));

		expect(screen.getByText("Show unavailable")).toBeOnTheScreen();
		expect(
			screen.getByText("This entity is not a show, and only shows can be opened here."),
		).toBeOnTheScreen();
	});

	it("renders decoded show values in the summary header and overview", async () => {
		await renderContent(readyState());

		expect(screen.getByText("Adolescence")).toBeOnTheScreen();
		expect(screen.getByText("TV Show • TMDB • 2025")).toBeOnTheScreen();
		expect(screen.getByText("TMDB")).toBeOnTheScreen();
		expect(screen.getByText("Drama")).toBeOnTheScreen();
		expect(screen.getByText("TMDB rating")).toBeOnTheScreen();
		expect(screen.getByText("78.25 / 100")).toBeOnTheScreen();
		expect(screen.getByText("Ended")).toBeOnTheScreen();
		expect(screen.getByText("Season")).toBeOnTheScreen();
		expect(screen.getByText("1")).toBeOnTheScreen();
		expect(screen.getByText("4")).toBeOnTheScreen();
		expect(screen.getByText("A four-part limited series.")).toBeOnTheScreen();
		expect(screen.queryByText("show-1")).not.toBeOnTheScreen();
	});

	it("renders library, ownership, collection and status facts in the rail", async () => {
		await renderContent(readyState());

		expect(screen.getByText("In library")).toBeOnTheScreen();
		expect(screen.getByText("Ownership")).toBeOnTheScreen();
		expect(screen.getByText("Not recorded")).toBeOnTheScreen();
		expect(screen.getByText("Collections")).toBeOnTheScreen();
		expect(screen.getByText("1 collection")).toBeOnTheScreen();
		expect(screen.getByText("Your status")).toBeOnTheScreen();
		expect(screen.getByText("Complete")).toBeOnTheScreen();
		expect(screen.getByRole("button", { name: "Manage" })).toBeOnTheScreen();
	});

	it("explains an empty collection membership in the rail", async () => {
		await renderContent(
			readyState({ collections: { pageInfo: { hasMore: false, limit: 6 }, items: [] } }),
		);

		expect(screen.getByText("Not in any collection")).toBeOnTheScreen();
		expect(screen.queryByText("1 collection")).not.toBeOnTheScreen();
	});

	it("omits summary values that the provider did not record", async () => {
		await renderContent(
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

		expect(screen.getByText("TV Show")).toBeOnTheScreen();
		expect(screen.queryByText("TMDB")).not.toBeOnTheScreen();
		expect(screen.queryByText("A four-part limited series.")).not.toBeOnTheScreen();
		expect(screen.queryByText("Provider rating")).not.toBeOnTheScreen();
		expect(screen.queryByText("Production status")).not.toBeOnTheScreen();
		expect(screen.queryByText("Season")).not.toBeOnTheScreen();
	});

	it("keeps Overview selected and leaves state unchanged for deferred controls", async () => {
		const user = userEvent.setup();
		await renderContent(readyState());
		const monitoring = screen.getByRole("switch", { name: "Toggle media monitoring" });

		await user.press(screen.getByRole("tab", { name: "Activity" }));
		await user.press(monitoring);
		await user.press(screen.getByRole("button", { name: "Log activity" }));

		expect(screen.getByRole("tab", { name: "Overview" })).toBeSelected();
		expect(screen.getByRole("tab", { name: "Activity" })).not.toBeSelected();
		expect(monitoring).not.toBeChecked();
	});

	it("loads the episodes tab only once it is selected", async () => {
		const user = userEvent.setup();
		const loads: number[] = [];
		await renderContent(readyState(), {
			episodes: <EpisodesTabProbe onLoad={() => loads.push(1)} />,
		});

		expect(loads).toEqual([]);
		expect(screen.getByText("Cast & crew")).toBeOnTheScreen();

		await user.press(screen.getByRole("tab", { name: "Episodes" }));

		expect(loads).toEqual([1]);
		expect(screen.getByRole("tab", { name: "Episodes" })).toBeSelected();
		expect(screen.getByRole("tab", { name: "Overview" })).not.toBeSelected();
		expect(screen.getByText("Adolescence")).toBeOnTheScreen();
		expect(screen.getByText("Episode 1: The Arrest")).toBeOnTheScreen();
		expect(screen.queryByText("Cast & crew")).not.toBeOnTheScreen();
	});

	it("returns to the preserved overview after visiting episodes", async () => {
		const user = userEvent.setup();
		await renderContent(readyState());

		await user.press(screen.getByRole("tab", { name: "Episodes" }));
		await user.press(screen.getByRole("tab", { name: "Overview" }));

		expect(screen.getByRole("tab", { name: "Overview" })).toBeSelected();
		expect(screen.getByText("Cast & crew")).toBeOnTheScreen();
		expect(screen.getByText("Owen Cooper")).toBeOnTheScreen();
		expect(screen.queryByText("Episode 1: The Arrest")).not.toBeOnTheScreen();
	});

	it("expands and re-clamps the description from the header", async () => {
		const user = userEvent.setup();
		await renderContent(readyState());

		expect(description()).toHaveProp("numberOfLines", 3);

		await user.press(screen.getByRole("button", { name: "More" }));

		expect(description()).not.toHaveProp("numberOfLines");

		await user.press(screen.getByRole("button", { name: "Less" }));

		expect(description()).toHaveProp("numberOfLines", 3);
	});
	it("renders images, credits, companies and recommendations in the overview", async () => {
		await renderContent(readyState());

		expect(screen.getByText("Images")).toBeOnTheScreen();
		expect(screen.getByText("Cast & crew")).toBeOnTheScreen();
		expect(screen.getByText("Owen Cooper")).toBeOnTheScreen();
		expect(screen.getByText("Actor, Guest Star")).toBeOnTheScreen();
		expect(screen.getByText("as Jamie")).toBeOnTheScreen();
		expect(screen.getByText("Production companies")).toBeOnTheScreen();
		expect(screen.getByText("Warp Films")).toBeOnTheScreen();
		expect(screen.getByText("Production Company")).toBeOnTheScreen();
		expect(screen.getByText("More like this")).toBeOnTheScreen();
		expect(screen.getByText("Bad Girls")).toBeOnTheScreen();
	});

	it("omits credit detail that the provider did not record", async () => {
		await renderContent(readyState(), {
			overview: overviewState({
				companies: [{ ...showCompanyRow, roles: null }],
				people: [{ ...showPersonRow, roles: [], character: null }],
			}),
		});

		expect(screen.getByText("Owen Cooper")).toBeOnTheScreen();
		expect(screen.getByText("Warp Films")).toBeOnTheScreen();
		expect(screen.queryByText("as Jamie")).not.toBeOnTheScreen();
		expect(screen.queryByText("Actor, Guest Star")).not.toBeOnTheScreen();
		expect(screen.queryByText("Production Company")).not.toBeOnTheScreen();
	});

	it("keeps layout placeholders for credits and suggestions without images", async () => {
		await renderContent(readyState({ images: null }), {
			overview: overviewState({
				people: [{ ...showPersonRow, images: null }],
				companies: [{ ...showCompanyRow, images: null }],
				recommendations: [{ ...showRecommendationRow, images: null }],
			}),
		});

		expect(screen.queryByText("Images")).not.toBeOnTheScreen();
		expect(screen.getByText("Owen Cooper")).toBeOnTheScreen();
		expect(screen.getByText("Warp Films")).toBeOnTheScreen();
		expect(screen.getByText("Bad Girls")).toBeOnTheScreen();
	});

	it("omits overview sections that hold no relationships", async () => {
		await renderContent(readyState(), {
			overview: overviewState({ people: [], recommendations: [] }),
		});

		expect(screen.getByText("Production companies")).toBeOnTheScreen();
		expect(screen.queryByText("Cast & crew")).not.toBeOnTheScreen();
		expect(screen.queryByText("More like this")).not.toBeOnTheScreen();
		expect(screen.queryByRole("button", { name: "View all people" })).not.toBeOnTheScreen();
	});

	it("renders nothing relational when the show has no credits or suggestions", async () => {
		await renderContent(readyState(), {
			overview: mapShowOverview(AsyncResult.success(emptyShowOverview())),
		});

		expect(screen.getByText("Images")).toBeOnTheScreen();
		expect(screen.queryByText("Cast & crew")).not.toBeOnTheScreen();
		expect(screen.queryByText("Production companies")).not.toBeOnTheScreen();
		expect(screen.queryByText("More like this")).not.toBeOnTheScreen();
	});

	it("links each recommendation to its own entity route", async () => {
		await renderContent(readyState());

		expect(screen.getByRole("link", { name: "Open Bad Girls" })).toHaveProp("href", "/e/show-2");
	});

	it("leaves the overview unchanged for deferred view-all actions", async () => {
		const user = userEvent.setup();
		await renderContent(readyState());

		await user.press(screen.getByRole("button", { name: "View all images" }));
		await user.press(screen.getByRole("button", { name: "View all people" }));

		expect(screen.getByRole("tab", { name: "Overview" })).toBeSelected();
		expect(screen.getByText("Owen Cooper")).toBeOnTheScreen();
		expect(screen.getByText("Bad Girls")).toBeOnTheScreen();
	});

	it("keeps the summary hero readable while the overview query is pending", async () => {
		await renderContent(readyState(), { overview: mapShowOverview(AsyncResult.initial(true)) });

		expect(screen.getByText("Adolescence")).toBeOnTheScreen();
		expect(screen.getByText("Loading details...")).toBeOnTheScreen();
		expect(screen.queryByText("Cast & crew")).not.toBeOnTheScreen();
	});

	it("keeps the summary hero readable and offers a retry when the overview fails", async () => {
		const user = userEvent.setup();
		const retries: number[] = [];
		await renderContent(readyState(), {
			refreshOverview: () => retries.push(1),
			overview: mapShowOverview(AsyncResult.failure(Cause.fail(new Error("offline")))),
		});

		await user.press(screen.getByRole("button", { name: "Try again" }));

		expect(screen.getByText("Adolescence")).toBeOnTheScreen();
		expect(screen.getByText("Images")).toBeOnTheScreen();
		expect(screen.getByText("Unable to load these details")).toBeOnTheScreen();
		expect(retries).toEqual([1]);
	});

	it("hides overview decoder internals behind a stable message", async () => {
		const cause = Cause.fail(new RyotQLMalformedResultError("bad credit row"));
		await renderContent(readyState(), { overview: mapShowOverview(AsyncResult.failure(cause)) });

		expect(screen.getByText("Adolescence")).toBeOnTheScreen();
		expect(screen.getByText("Unable to load these details")).toBeOnTheScreen();
		expect(screen.queryByText(/bad credit row/)).not.toBeOnTheScreen();
	});
});
