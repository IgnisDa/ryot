import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { ShowScreenContent } from "./show-screen-content";
import { decodeShowSummaryResult, showSummaryRow } from "./show-summary-fixture";
import { mapShowSummary, type ShowSummaryState } from "./show-summary-state";

const NO_MANAGED_URLS: ReadonlyMap<string, string> = new Map();

const clamps = () =>
	screen.getAllByText("A four-part limited series.").map((node) => node.props.numberOfLines);
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

const renderContent = (state: ShowSummaryState, refresh: () => void = () => undefined) =>
	render(<ShowScreenContent state={state} refresh={refresh} managedUrls={NO_MANAGED_URLS} />);

describe("show screen content", () => {
	it("renders the loading branch while the summary query is pending", async () => {
		await renderContent(mapShowSummary(AsyncResult.initial(true)));

		expect(screen.getByText("Loading show...")).toBeOnTheScreen();
		expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeOnTheScreen();
	});

	it("offers a retry from the transport error branch", async () => {
		const user = userEvent.setup();
		const retries: number[] = [];
		await renderContent(mapShowSummary(AsyncResult.failure(Cause.fail(new Error("offline")))), () =>
			retries.push(1),
		);

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
		expect(screen.getAllByText("TMDB")).toHaveLength(2);
		expect(screen.getByText("Drama")).toBeOnTheScreen();
		expect(screen.getByText("TMDB rating")).toBeOnTheScreen();
		expect(screen.getByText("78.25 / 100")).toBeOnTheScreen();
		expect(screen.getByText("78.25")).toBeOnTheScreen();
		expect(screen.getAllByText("Ended")).toHaveLength(2);
		expect(screen.getByText("Season")).toBeOnTheScreen();
		expect(screen.getByText("1")).toBeOnTheScreen();
		expect(screen.getByText("4")).toBeOnTheScreen();
		expect(screen.getByText("1 season")).toBeOnTheScreen();
		expect(screen.getByText("4 episodes")).toBeOnTheScreen();
		expect(screen.getAllByText("A four-part limited series.")).toHaveLength(2);
		expect(screen.getByText("show-1")).toBeOnTheScreen();
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
		expect(screen.queryByText("1 season")).not.toBeOnTheScreen();
	});

	it("keeps Overview selected and leaves state unchanged for deferred controls", async () => {
		const user = userEvent.setup();
		await renderContent(readyState());
		const monitoring = screen.getByRole("switch", { name: "Toggle media monitoring" });

		await user.press(screen.getByRole("tab", { name: "Episodes" }));
		await user.press(monitoring);
		await user.press(screen.getByRole("button", { name: "Log activity" }));

		expect(screen.getByRole("tab", { name: "Overview" })).toBeSelected();
		expect(screen.getByRole("tab", { name: "Episodes" })).not.toBeSelected();
		expect(monitoring).not.toBeChecked();
	});

	it("expands and re-clamps every description slot from one toggle", async () => {
		const user = userEvent.setup();
		await renderContent(readyState());

		expect(clamps()).toEqual([3, 3]);

		await user.press(screen.getAllByRole("button", { name: "More" })[0]);

		expect(clamps()).toEqual([undefined, undefined]);

		await user.press(screen.getAllByRole("button", { name: "Less" })[1]);

		expect(clamps()).toEqual([3, 3]);
	});
});
