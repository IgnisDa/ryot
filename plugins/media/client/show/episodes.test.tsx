// @vitest-environment jsdom

import { fireEvent, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import { ShowEpisodes } from "./episodes";
import {
	decodeShowEpisodesResult,
	decodeShowSeasonEpisodesResult,
	showEpisodeRow,
	showSeasonRow,
} from "./episodes-fixture";
import {
	mapShowEpisodes,
	mapShowSeasonEpisodes,
	type ShowEpisodesState,
	type ShowSeasonEpisodesState,
} from "./episodes-state";
import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "./query-result-fixture";
import { mountRyotClient } from "./test-support";

const noopAdapter = { query: () => Promise.resolve({}) };

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
	mapShowEpisodes(readyQueryResult(decodeShowEpisodesResult({ seasons })));

const readySeasonEpisodes = (
	input: Parameters<typeof decodeShowSeasonEpisodesResult>[0] = {},
): ShowSeasonEpisodesState =>
	mapShowSeasonEpisodes(readyQueryResult(decodeShowSeasonEpisodesResult(input)));

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
) =>
	mountRyotClient(
		noopAdapter,
		<ShowEpisodes {...showEpisodesProps(state, seasonEpisodes, options)} />,
	);

afterEach(() => {
	document.body.innerHTML = "";
});

const textOf = (container: HTMLElement, text: string) =>
	Array.from(container.querySelectorAll("*")).find((element) => element.textContent === text);

describe("show episodes tab", () => {
	it("renders the season header from the loaded season and episode state", () => {
		const { container, unmount } = renderEpisodes(readyState());

		expect(container.textContent).toContain("Season 1");
		expect(textOf(container, "Released Mar 13, 2025 • 1 episode • 1 watched")).not.toBeUndefined();
		expect(container.textContent).toContain("The complete limited series.");
		unmount();
	});

	it("renders episode metadata and a quiet lifecycle indicator", () => {
		const { container, unmount } = renderEpisodes(readyState());

		expect(container.textContent).toContain("E1");
		expect(container.textContent).toContain("Episode 1: The Arrest");
		expect(textOf(container, "Mar 13, 2025 • 66 min")).not.toBeUndefined();
		expect(container.textContent).toContain("A thirteen-year-old is arrested at dawn.");
		expect(container.textContent).toContain("Watched");
		unmount();
	});

	it("omits episode metadata the provider did not record", () => {
		const { container, unmount } = renderEpisodes(
			readyState([showSeasonRow]),
			readySeasonEpisodes({
				episodes: [
					episode({ runtime: null, publishDate: null, description: null, state: "untracked" }),
				],
			}),
		);

		expect(container.textContent).toContain("Episode 1: The Arrest");
		expect(textOf(container, "Mar 13, 2025 • 66 min")).toBeUndefined();
		expect(container.textContent).not.toContain("A thirteen-year-old is arrested at dawn.");
		expect(container.textContent).not.toContain("Watched");
		expect(container.textContent).not.toContain("In progress");
		unmount();
	});

	it("never presents a partially loaded season as an exact total", () => {
		const { container, unmount } = renderEpisodes(
			readyState([showSeasonRow]),
			readySeasonEpisodes({ hasMore: true }),
		);

		expect(
			textOf(container, "Released Mar 13, 2025 • 1+ episodes • 1 watched"),
		).not.toBeUndefined();
		unmount();
	});

	it("offers the next regular episode to continue with", () => {
		const { container, unmount } = renderEpisodes(
			readyState([showSeasonRow]),
			readySeasonEpisodes({ episodes: [showEpisodeRow, secondEpisode] }),
		);

		expect(container.textContent).toContain("Next up");
		expect(textOf(container, "S1 • E2")).not.toBeUndefined();
		expect(
			Array.from(container.querySelectorAll("*")).filter(
				(element) =>
					element.textContent === "Episode 2: The Interview" && element.children.length === 0,
			),
		).toHaveLength(2);
		unmount();
	});

	it("hides next up when nothing sensible follows", () => {
		const { container, unmount } = renderEpisodes(readyState());

		expect(container.textContent).not.toContain("Next up");
		unmount();
	});

	it("selects seasons from the season list and keeps specials last", () => {
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
		const { container, rerender, unmount } = renderEpisodes(state, readySeasonEpisodes(), {
			onSelect,
		});

		const seasonOneRadio = Array.from(container.querySelectorAll('[role="radio"]')).find(
			(element) => element.textContent === "Season 1",
		);
		expect(seasonOneRadio?.getAttribute("aria-checked")).toBe("true");
		expect(container.textContent).toContain("Episode 1: The Arrest");

		const seasonTwoRadio = Array.from(container.querySelectorAll('[role="radio"]')).find(
			(element) => element.textContent === "Season 2",
		);
		if (seasonTwoRadio === undefined) {
			throw new Error("Expected the Season 2 radio");
		}
		fireEvent.click(seasonTwoRadio);
		expect(selections).toEqual(["season-2"]);

		rerender(
			<ShowEpisodes {...showEpisodesProps(state, seasonTwoEpisodes, { onSelect, selectedId })} />,
		);

		const selectedRadio = Array.from(container.querySelectorAll('[role="radio"]')).find(
			(element) => element.textContent === "Season 2",
		);
		expect(selectedRadio?.getAttribute("aria-checked")).toBe("true");
		expect(container.textContent).toContain("Episode 1: Aftermath");
		expect(container.textContent).not.toContain("Episode 1: The Arrest");
		unmount();
	});

	it("does not show old episodes while the selected season is loading", () => {
		const state = readyState([
			showSeasonRow,
			{ ...showSeasonRow, id: "season-2", seasonNumber: 2, name: "Season 2" },
		]);
		let selectedId: string | null = null;
		const onSelect = (seasonId: string) => {
			selectedId = seasonId;
		};
		const { container, rerender, unmount } = renderEpisodes(state, readySeasonEpisodes(), {
			onSelect,
		});

		expect(container.textContent).toContain("Episode 1: The Arrest");

		selectedId = "season-2";
		rerender(
			<ShowEpisodes
				{...showEpisodesProps(state, mapShowSeasonEpisodes(pendingQueryResult()), {
					onSelect,
					selectedId,
				})}
			/>,
		);

		expect(container.textContent).toContain("Loading season...");
		expect(container.textContent).not.toContain("Episode 1: The Arrest");
		unmount();
	});

	it("labels season zero as specials and drops next up while it is selected", () => {
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
		const { container, rerender, unmount } = renderEpisodes(state, regularEpisodes, { onSelect });

		expect(container.textContent).toContain("Next up");

		const specialsRadio = Array.from(container.querySelectorAll('[role="radio"]')).find(
			(element) => element.textContent === "Specials",
		);
		if (specialsRadio === undefined) {
			throw new Error("Expected the Specials radio");
		}
		fireEvent.click(specialsRadio);
		rerender(
			<ShowEpisodes {...showEpisodesProps(state, specialsEpisodes, { onSelect, selectedId })} />,
		);

		expect(container.textContent).toContain("Making Adolescence");
		expect(container.textContent).not.toContain("Next up");
		expect(container.textContent).not.toContain("Released");
		unmount();
	});

	it("keeps a show with only specials readable", () => {
		const { container, unmount } = renderEpisodes(
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

		expect(container.textContent).toContain("Specials");
		expect(container.textContent).toContain("Making Adolescence");
		expect(container.querySelector('[role="radio"]')).toBeNull();
		unmount();
	});

	it("explains a season that has no episodes recorded", () => {
		const { container, unmount } = renderEpisodes(
			readyState([showSeasonRow]),
			readySeasonEpisodes({ episodes: [] }),
		);

		expect(container.textContent).toContain("No episodes have been recorded for this season yet.");
		unmount();
	});

	it("explains a show that has no seasons at all", () => {
		const { container, unmount } = renderEpisodes(readyState([]));

		expect(container.textContent).toContain("No episodes yet");
		unmount();
	});

	it("renders a tab-local loading branch", () => {
		const { container, unmount } = renderEpisodes(mapShowEpisodes(pendingQueryResult()));

		expect(container.textContent).toContain("Loading episodes...");
		unmount();
	});

	it("offers a retry when the episodes query fails", () => {
		const retries: number[] = [];
		const { container, unmount } = renderEpisodes(
			mapShowEpisodes(transportErrorQueryResult()),
			readySeasonEpisodes(),
			{ refresh: () => retries.push(1) },
		);

		const retry = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Try again",
		);
		if (retry === undefined) {
			throw new Error("Expected the episodes retry button");
		}
		fireEvent.click(retry);

		expect(container.textContent).toContain("Unable to load episodes");
		expect(retries).toEqual([1]);
		unmount();
	});

	it("hides episode decoder internals behind a stable message", () => {
		const { container, unmount } = renderEpisodes(mapShowEpisodes(malformedQueryResult()));

		expect(container.textContent).toContain("Unable to load episodes");
		unmount();
	});

	it("leaves the tab unchanged when a deferred episode action is pressed", async () => {
		const { container, unmount } = renderEpisodes(
			readyState([showSeasonRow]),
			readySeasonEpisodes({ episodes: [showEpisodeRow, secondEpisode] }),
		);

		const open = Array.from(container.querySelectorAll("button")).find(
			(button) => button.getAttribute("aria-label") === "Open Episode 1: The Arrest",
		);
		if (open === undefined) {
			throw new Error("Expected the episode open button");
		}
		fireEvent.click(open);
		await waitFor(() => expect(container.textContent).toContain("Watched"));

		expect(container.textContent).toContain("Next up");
		expect(textOf(container, "Released Mar 13, 2025 • 2 episodes • 1 watched")).not.toBeUndefined();
		unmount();
	});
});
