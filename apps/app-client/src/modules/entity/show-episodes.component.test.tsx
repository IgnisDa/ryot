import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { ShowEpisodes } from "./show-episodes";
import {
	decodeShowEpisodesResult,
	decodeShowSeasonEpisodesResult,
	showEpisodeRow,
	showSeasonRow,
} from "./show-episodes-fixture";
import {
	mapShowEpisodes,
	mapShowSeasonEpisodes,
	type ShowEpisodesState,
	type ShowSeasonEpisodesState,
} from "./show-episodes-state";

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
};

const readyState = (seasons?: SeasonInput): ShowEpisodesState =>
	mapShowEpisodes(AsyncResult.success(decodeShowEpisodesResult({ seasons })));

const readySeasonEpisodes = (
	input: Parameters<typeof decodeShowSeasonEpisodesResult>[0] = {},
): ShowSeasonEpisodesState =>
	mapShowSeasonEpisodes(AsyncResult.success(decodeShowSeasonEpisodesResult(input)));

type RenderOptions = {
	readonly refresh?: () => void;
	readonly selectedId?: string | null;
	readonly onRefreshSeason?: () => void;
	readonly onSelect?: (seasonId: string) => void;
};

const showEpisodesProps = (
	state: ShowEpisodesState,
	seasonEpisodes: ShowSeasonEpisodesState = readySeasonEpisodes(),
	options: RenderOptions = {},
) => ({
	state,
	seasonEpisodes,
	selectedId: options.selectedId ?? null,
	refresh: options.refresh ?? (() => undefined),
	onSelect: options.onSelect ?? (() => undefined),
	onRefreshSeason: options.onRefreshSeason ?? (() => undefined),
});

const renderEpisodes = (
	state: ShowEpisodesState,
	seasonEpisodes: ShowSeasonEpisodesState = readySeasonEpisodes(),
	options: RenderOptions = {},
) => render(<ShowEpisodes {...showEpisodesProps(state, seasonEpisodes, options)} />);

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
			readyState([showSeasonRow]),
			readySeasonEpisodes({
				episodes: [
					episode({ runtime: null, publishDate: null, description: null, state: "untracked" }),
				],
			}),
		);

		expect(screen.getByText("Episode 1: The Arrest")).toBeOnTheScreen();
		expect(screen.queryByText("Mar 13, 2025 • 66 min")).not.toBeOnTheScreen();
		expect(screen.queryByText("A thirteen-year-old is arrested at dawn.")).not.toBeOnTheScreen();
		expect(screen.queryByText("Watched")).not.toBeOnTheScreen();
		expect(screen.queryByText("In progress")).not.toBeOnTheScreen();
	});

	it("never presents a partially loaded season as an exact total", async () => {
		await renderEpisodes(readyState([showSeasonRow]), readySeasonEpisodes({ hasMore: true }));

		expect(screen.getByText("Released Mar 13, 2025 • 1+ episodes • 1 watched")).toBeOnTheScreen();
	});

	it("offers the next regular episode to continue with", async () => {
		await renderEpisodes(
			readyState([showSeasonRow]),
			readySeasonEpisodes({ episodes: [showEpisodeRow, secondEpisode] }),
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
		const state = readyState([
			specialsSeason,
			showSeasonRow,
			{ ...showSeasonRow, id: "season-2", seasonNumber: 2, name: "Season 2" },
		]);
		const seasonTwoEpisodes = readySeasonEpisodes({
			season: { ...showSeasonRow, id: "season-2", seasonNumber: 2, name: "Season 2" },
			episodes: [episode({ id: "episode-3", seasonNumber: 2, name: "Episode 1: Aftermath" })],
		});
		const selections: string[] = [];
		let selectedId: string | null = null;
		const onSelect = (seasonId: string) => {
			selections.push(seasonId);
			selectedId = seasonId;
		};
		const view = await renderEpisodes(state, readySeasonEpisodes(), { onSelect });

		expect(screen.getByRole("radio", { name: "Season 1" })).toBeChecked();
		expect(screen.getByText("Episode 1: The Arrest")).toBeOnTheScreen();

		await user.press(screen.getByRole("radio", { name: "Season 2" }));
		expect(selections).toEqual(["season-2"]);

		await view.rerender(
			<ShowEpisodes {...showEpisodesProps(state, seasonTwoEpisodes, { onSelect, selectedId })} />,
		);

		expect(screen.getByRole("radio", { name: "Season 2" })).toBeChecked();
		expect(screen.getByText("Episode 1: Aftermath")).toBeOnTheScreen();
		expect(screen.queryByText("Episode 1: The Arrest")).not.toBeOnTheScreen();
	});

	it("does not show old episodes while the selected season is loading", async () => {
		const state = readyState([
			showSeasonRow,
			{ ...showSeasonRow, id: "season-2", seasonNumber: 2, name: "Season 2" },
		]);
		let selectedId: string | null = null;
		const onSelect = (seasonId: string) => {
			selectedId = seasonId;
		};
		const view = await renderEpisodes(state, readySeasonEpisodes(), { onSelect });

		expect(screen.getByText("Episode 1: The Arrest")).toBeOnTheScreen();

		selectedId = "season-2";
		await view.rerender(
			<ShowEpisodes
				{...showEpisodesProps(state, mapShowSeasonEpisodes(AsyncResult.initial(true)), {
					onSelect,
					selectedId,
				})}
			/>,
		);

		expect(screen.getByText("Loading season...")).toBeOnTheScreen();
		expect(screen.queryByText("Episode 1: The Arrest")).not.toBeOnTheScreen();
	});

	it("labels season zero as specials and drops next up while it is selected", async () => {
		const user = userEvent.setup();
		const state = readyState([specialsSeason, showSeasonRow]);
		const regularEpisodes = readySeasonEpisodes({ episodes: [showEpisodeRow, secondEpisode] });
		const specialsEpisodes = readySeasonEpisodes({
			season: specialsSeason,
			episodes: [
				episode({
					seasonNumber: 0,
					id: "special-1",
					state: "untracked",
					name: "Making Adolescence",
				}),
			],
		});
		let selectedId: string | null = null;
		const onSelect = (seasonId: string) => {
			selectedId = seasonId;
		};
		const view = await renderEpisodes(state, regularEpisodes, { onSelect });

		expect(screen.getByText("Next up")).toBeOnTheScreen();

		await user.press(screen.getByRole("radio", { name: "Specials" }));
		await view.rerender(
			<ShowEpisodes {...showEpisodesProps(state, specialsEpisodes, { onSelect, selectedId })} />,
		);

		expect(screen.getByText("Making Adolescence")).toBeOnTheScreen();
		expect(screen.queryByText("Next up")).not.toBeOnTheScreen();
		expect(screen.queryByText("Released")).not.toBeOnTheScreen();
	});

	it("keeps a show with only specials readable", async () => {
		await renderEpisodes(
			readyState([specialsSeason]),
			readySeasonEpisodes({
				season: specialsSeason,
				episodes: [
					episode({
						seasonNumber: 0,
						id: "special-1",
						state: "untracked",
						name: "Making Adolescence",
					}),
				],
			}),
		);

		expect(screen.getByText("Specials")).toBeOnTheScreen();
		expect(screen.getByText("Making Adolescence")).toBeOnTheScreen();
		expect(screen.queryByRole("radio", { name: "Specials" })).not.toBeOnTheScreen();
	});

	it("explains a season that has no episodes recorded", async () => {
		await renderEpisodes(readyState([showSeasonRow]), readySeasonEpisodes({ episodes: [] }));

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
			readySeasonEpisodes(),
			{ refresh: () => retries.push(1) },
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
			readyState([showSeasonRow]),
			readySeasonEpisodes({ episodes: [showEpisodeRow, secondEpisode] }),
		);

		await user.press(screen.getByRole("button", { name: "Open Episode 1: The Arrest" }));

		expect(screen.getByText("Watched")).toBeOnTheScreen();
		expect(screen.getByText("Next up")).toBeOnTheScreen();
		expect(screen.getByText("Released Mar 13, 2025 • 2 episodes • 1 watched")).toBeOnTheScreen();
	});
});
