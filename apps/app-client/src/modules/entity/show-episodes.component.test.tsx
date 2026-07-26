import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { ShowEpisodes } from "./show-episodes";
import { decodeShowEpisodesResult, showEpisodeRow, showSeasonRow } from "./show-episodes-fixture";
import { mapShowEpisodes, type ShowEpisodesState } from "./show-episodes-state";

type SeasonInput = Parameters<typeof decodeShowEpisodesResult>[0]["seasons"];

const episode = (overrides: Record<string, unknown>) => ({ ...showEpisodeRow, ...overrides });

const secondEpisode = episode({
	id: "episode-2",
	episodeNumber: 2,
	state: "untracked",
	publishDate: "2025-03-20",
	name: "Episode 2: The Interview",
	description: "The detectives press for answers.",
});

const specialsSeason = {
	...showSeasonRow,
	id: "season-0",
	seasonNumber: 0,
	name: "Specials",
	releaseDate: null,
	description: null,
	episodes: [
		episode({ seasonNumber: 0, id: "special-1", state: "untracked", name: "Making Adolescence" }),
	],
};

const readyState = (seasons?: SeasonInput): ShowEpisodesState =>
	mapShowEpisodes(AsyncResult.success(decodeShowEpisodesResult({ seasons })));

const renderEpisodes = (state: ShowEpisodesState, refresh: () => void = () => undefined) =>
	render(<ShowEpisodes state={state} refresh={refresh} />);

describe("show episodes tab", () => {
	it("renders the season header from the loaded season and episode state", async () => {
		await renderEpisodes(readyState());

		expect(screen.getByText("Season 1")).toBeOnTheScreen();
		expect(screen.getByText("Released Mar 13, 2025 • 1 episode • 1 watched")).toBeOnTheScreen();
		expect(screen.getByText("The complete limited series.")).toBeOnTheScreen();
	});

	it("renders episode metadata and a quiet lifecycle indicator", async () => {
		await renderEpisodes(readyState());

		expect(screen.getByText("E1")).toBeOnTheScreen();
		expect(screen.getByText("Episode 1: The Arrest")).toBeOnTheScreen();
		expect(screen.getByText("Mar 13, 2025 • 66 min")).toBeOnTheScreen();
		expect(screen.getByText("A thirteen-year-old is arrested at dawn.")).toBeOnTheScreen();
		expect(screen.getByText("Watched")).toBeOnTheScreen();
	});

	it("omits episode metadata the provider did not record", async () => {
		await renderEpisodes(
			readyState([
				{
					...showSeasonRow,
					episodes: [
						episode({ runtime: null, publishDate: null, description: null, state: "untracked" }),
					],
				},
			]),
		);

		expect(screen.getByText("Episode 1: The Arrest")).toBeOnTheScreen();
		expect(screen.queryByText("Mar 13, 2025 • 66 min")).not.toBeOnTheScreen();
		expect(screen.queryByText("A thirteen-year-old is arrested at dawn.")).not.toBeOnTheScreen();
		expect(screen.queryByText("Watched")).not.toBeOnTheScreen();
		expect(screen.queryByText("In progress")).not.toBeOnTheScreen();
	});

	it("never presents a partially loaded season as an exact total", async () => {
		await renderEpisodes(
			readyState([{ ...showSeasonRow, hasMore: true, episodes: [showEpisodeRow] }]),
		);

		expect(screen.getByText("Released Mar 13, 2025 • 1+ episodes • 1 watched")).toBeOnTheScreen();
	});

	it("offers the next regular episode to continue with", async () => {
		await renderEpisodes(
			readyState([{ ...showSeasonRow, episodes: [showEpisodeRow, secondEpisode] }]),
		);

		expect(screen.getByText("Next up")).toBeOnTheScreen();
		expect(screen.getByText("S1 • E2")).toBeOnTheScreen();
		expect(screen.getAllByText("Episode 2: The Interview")).toHaveLength(2);
	});

	it("hides next up when nothing sensible follows", async () => {
		await renderEpisodes(readyState());

		expect(screen.queryByText("Next up")).not.toBeOnTheScreen();
	});

	it("selects seasons from the season list and keeps specials last", async () => {
		const user = userEvent.setup();
		await renderEpisodes(
			readyState([
				specialsSeason,
				{ ...showSeasonRow, episodes: [showEpisodeRow] },
				{
					...showSeasonRow,
					id: "season-2",
					seasonNumber: 2,
					name: "Season 2",
					episodes: [episode({ id: "episode-3", seasonNumber: 2, name: "Episode 1: Aftermath" })],
				},
			]),
		);

		expect(screen.getByRole("radio", { name: "Season 1" })).toBeChecked();
		expect(screen.getByText("Episode 1: The Arrest")).toBeOnTheScreen();

		await user.press(screen.getByRole("radio", { name: "Season 2" }));

		expect(screen.getByRole("radio", { name: "Season 2" })).toBeChecked();
		expect(screen.getByText("Episode 1: Aftermath")).toBeOnTheScreen();
		expect(screen.queryByText("Episode 1: The Arrest")).not.toBeOnTheScreen();
	});

	it("labels season zero as specials and drops next up while it is selected", async () => {
		const user = userEvent.setup();
		await renderEpisodes(
			readyState([specialsSeason, { ...showSeasonRow, episodes: [showEpisodeRow, secondEpisode] }]),
		);

		expect(screen.getByText("Next up")).toBeOnTheScreen();

		await user.press(screen.getByRole("radio", { name: "Specials" }));

		expect(screen.getByText("Making Adolescence")).toBeOnTheScreen();
		expect(screen.queryByText("Next up")).not.toBeOnTheScreen();
		expect(screen.queryByText("Released")).not.toBeOnTheScreen();
	});

	it("keeps a show with only specials readable", async () => {
		await renderEpisodes(readyState([specialsSeason]));

		expect(screen.getByText("Specials")).toBeOnTheScreen();
		expect(screen.getByText("Making Adolescence")).toBeOnTheScreen();
		expect(screen.queryByRole("radio", { name: "Specials" })).not.toBeOnTheScreen();
	});

	it("explains a season that has no episodes recorded", async () => {
		await renderEpisodes(readyState([{ ...showSeasonRow, episodes: [] }]));

		expect(
			screen.getByText("No episodes have been recorded for this season yet."),
		).toBeOnTheScreen();
	});

	it("explains a show that has no seasons at all", async () => {
		await renderEpisodes(readyState([]));

		expect(screen.getByText("No episodes yet")).toBeOnTheScreen();
	});

	it("renders a tab-local loading branch", async () => {
		await renderEpisodes(mapShowEpisodes(AsyncResult.initial(true)));

		expect(screen.getByText("Loading episodes...")).toBeOnTheScreen();
	});

	it("offers a retry when the episodes query fails", async () => {
		const user = userEvent.setup();
		const retries: number[] = [];
		await renderEpisodes(
			mapShowEpisodes(AsyncResult.failure(Cause.fail(new Error("offline")))),
			() => retries.push(1),
		);

		await user.press(screen.getByRole("button", { name: "Try again" }));

		expect(screen.getByText("Unable to load episodes")).toBeOnTheScreen();
		expect(retries).toEqual([1]);
	});

	it("hides episode decoder internals behind a stable message", async () => {
		const cause = Cause.fail(new RyotQLMalformedResultError("bad episode row"));
		await renderEpisodes(mapShowEpisodes(AsyncResult.failure(cause)));

		expect(screen.getByText("Unable to load episodes")).toBeOnTheScreen();
		expect(screen.queryByText(/bad episode row/)).not.toBeOnTheScreen();
	});

	it("leaves the tab unchanged when a deferred episode action is pressed", async () => {
		const user = userEvent.setup();
		await renderEpisodes(
			readyState([{ ...showSeasonRow, episodes: [showEpisodeRow, secondEpisode] }]),
		);

		await user.press(screen.getByRole("button", { name: "Open Episode 1: The Arrest" }));

		expect(screen.getByText("Watched")).toBeOnTheScreen();
		expect(screen.getByText("Next up")).toBeOnTheScreen();
		expect(screen.getByText("Released Mar 13, 2025 • 2 episodes • 1 watched")).toBeOnTheScreen();
	});
});
