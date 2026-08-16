import type { RyotClientAdapter } from "@ryot-app/client-sdk";
import { fireEvent, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import { rowsResult } from "../../tests/client/query-result-fixture";
import {
	decodeShowSeasonEpisodesResult,
	showEpisodeRow,
	showSeasonRow,
} from "../../tests/client/show/episodes-fixture";
import { flushRyotClient, mountRyotClient } from "../../tests/client/test-support";
import { ShowEpisodesTab } from "./episodes";
import type { ShowEpisode } from "./episodes-state";

const rows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 60, hasMore: false, nextCursor: null });

const specialsSeason = {
	...showSeasonRow,
	id: "season-0",
	seasonNumber: 0,
	episodeTotal: 2,
	watchedTotal: 0,
	name: "Specials",
	releaseDate: null,
	description: null,
};

const secondSeason = {
	...showSeasonRow,
	id: "season-2",
	seasonNumber: 2,
	episodeTotal: 3,
	watchedTotal: 0,
	name: "Season 2",
};

const secondEpisode = {
	...showEpisodeRow,
	id: "episode-2",
	episodeNumber: 2,
	state: "untracked",
	name: "Episode 2: The Interview",
};

const showAdapter = (input: {
	readonly seasons?: readonly Record<string, unknown>[];
	readonly episodes?: (seasonId: string) => readonly Record<string, unknown>[];
}) => {
	const adapter: Partial<RyotClientAdapter> = {
		watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
		query: (document) => {
			const serialized = JSON.stringify(document);
			if (serialized.includes('"episodes"')) {
				const seasonId =
					["season-0", "season-2"].find((id) => serialized.includes(id)) ?? "season-1";
				return Promise.resolve({
					data: { episodes: rows(input.episodes?.(seasonId) ?? [showEpisodeRow]) },
				});
			}
			return Promise.resolve({
				data: {
					show: rows([
						{
							id: "show-1",
							schemaSlug: "show",
							name: "Adolescence",
							episodeOrders: null,
							populationStatus: "ready",
							translationStatus: "none",
							seasons: rows(input.seasons ?? [showSeasonRow]),
						},
					]),
				},
			});
		},
	};
	return adapter;
};

const [summaryNextUp] = decodeShowSeasonEpisodesResult({ episodes: [secondEpisode] }).items;

const renderTab = (adapter: Partial<RyotClientAdapter>, nextUp: ShowEpisode | null = null) =>
	mountRyotClient(adapter, <ShowEpisodesTab compact entityId="show-1" summary={{ nextUp }} />);

const textOf = (container: HTMLElement, text: string) =>
	Array.from(container.querySelectorAll("*")).find((element) => element.textContent === text);

const radio = (container: HTMLElement, label: string) =>
	Array.from(container.querySelectorAll('[role="radio"]')).find(
		(element) => element.textContent === label,
	);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("show season browser", () => {
	it("heads the season with the counts the season query reports, not the loaded page", async () => {
		const view = renderTab(
			showAdapter({
				seasons: [{ ...showSeasonRow, episodeTotal: 6, watchedTotal: 2, upcomingTotal: 3 }],
			}),
		);
		await flushRyotClient();

		await waitFor(() => expect(view.container.textContent).toContain("Season 1"));
		expect(
			textOf(view.container, "Released Mar 13, 2025 • 2/6 aired · 3 upcoming"),
		).not.toBeUndefined();
		expect(view.container.textContent).toContain("The complete limited series.");
		expect(view.container.textContent).toContain("Episode 1: The Arrest");
		view.unmount();
	});

	it("selects seasons from the season list and keeps specials last", async () => {
		const view = renderTab(
			showAdapter({
				seasons: [specialsSeason, showSeasonRow, secondSeason],
				episodes: (seasonId) =>
					seasonId === "season-2"
						? [{ ...showEpisodeRow, id: "episode-3", name: "Episode 1: Aftermath" }]
						: [showEpisodeRow],
			}),
		);
		await flushRyotClient();
		await waitFor(() => expect(view.container.textContent).toContain("Episode 1: The Arrest"));

		expect(
			Array.from(view.container.querySelectorAll('[role="radio"]')).map(
				(element) => element.textContent,
			),
		).toEqual(["Season 1", "Season 2", "Specials"]);
		expect(radio(view.container, "Season 1")?.getAttribute("aria-checked")).toBe("true");

		const seasonTwo = radio(view.container, "Season 2");
		if (seasonTwo === undefined) {
			throw new Error("Expected the Season 2 radio");
		}
		fireEvent.click(seasonTwo);
		await flushRyotClient();

		await waitFor(() => expect(view.container.textContent).toContain("Episode 1: Aftermath"));
		expect(radio(view.container, "Season 2")?.getAttribute("aria-checked")).toBe("true");
		expect(view.container.textContent).not.toContain("Episode 1: The Arrest");
		view.unmount();
	});

	it("leads only the season that holds the summary's next up with it", async () => {
		const view = renderTab(
			showAdapter({
				seasons: [specialsSeason, showSeasonRow],
				episodes: (seasonId) =>
					seasonId === "season-0"
						? [{ ...showEpisodeRow, id: "special-1", seasonNumber: 0, state: "untracked" }]
						: [showEpisodeRow],
			}),
			summaryNextUp,
		);
		await flushRyotClient();
		await waitFor(() => expect(view.container.textContent).toContain("Next up"));

		expect(textOf(view.container, "S1 • E2")).not.toBeUndefined();

		const specials = radio(view.container, "Specials");
		if (specials === undefined) {
			throw new Error("Expected the Specials radio");
		}
		fireEvent.click(specials);
		await flushRyotClient();

		await waitFor(() => expect(view.container.textContent).not.toContain("Next up"));
		expect(view.container.textContent).not.toContain("Released");
		view.unmount();
	});

	it("keeps a show with only specials readable and without a selector", async () => {
		const view = renderTab(
			showAdapter({
				seasons: [specialsSeason],
				episodes: () => [{ ...showEpisodeRow, id: "special-1", seasonNumber: 0 }],
			}),
		);
		await flushRyotClient();

		await waitFor(() => expect(view.container.textContent).toContain("Specials"));
		expect(view.container.querySelector('[role="radio"]')).toBeNull();
		view.unmount();
	});

	it("explains a show that has no seasons at all", async () => {
		const view = renderTab(showAdapter({ seasons: [] }));
		await flushRyotClient();

		await waitFor(() => expect(view.container.textContent).toContain("No episodes yet"));
		view.unmount();
	});

	it("offers a retry when the seasons query fails", async () => {
		const view = mountRyotClient(
			{
				query: () => Promise.reject(new Error("offline")),
				watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
			},
			<ShowEpisodesTab compact entityId="show-1" summary={undefined} />,
		);
		await flushRyotClient();

		await waitFor(() => expect(view.container.textContent).toContain("Unable to load episodes"));
		expect(
			Array.from(view.container.querySelectorAll("button")).some(
				(button) => button.textContent === "Try again",
			),
		).toBe(true);
		view.unmount();
	});
});
