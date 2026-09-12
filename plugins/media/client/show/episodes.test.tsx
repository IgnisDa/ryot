import type { RyotClientAdapter } from "@ryot-app/client-sdk";
import { createTestPluginStorage } from "@ryot-app/client-sdk/testing";
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

const orderEpisodeRow = (number: number) => ({
	...showEpisodeRow,
	state: "untracked",
	episodeNumber: number,
	id: `episode-${number}`,
	name: `Episode ${number}`,
	externalId: `tmdb-${number}`,
});

const orderEpisodeRows = Array.from({ length: 61 }, (_, index) => orderEpisodeRow(index + 1));

const dvdOrder = {
	type: "dvd",
	name: "DVD Order",
	description: null,
	externalId: "order-dvd",
	groups: [
		{ order: 1, name: "Volume 1", episodeExternalIds: ["tmdb-3", "tmdb-1"] },
		{ order: 2, name: "Volume 2", episodeExternalIds: ["tmdb-2"] },
	],
};

const absoluteOrder = {
	type: "absolute",
	description: null,
	name: "Absolute Order",
	externalId: "order-absolute",
	groups: [
		{
			order: 1,
			name: "All episodes",
			episodeExternalIds: orderEpisodeRows.map(({ externalId }) => externalId),
		},
	],
};

const showAdapter = (input: {
	readonly queries?: string[];
	readonly episodeOrders?: readonly Record<string, unknown>[];
	readonly seasons?: readonly Record<string, unknown>[];
	readonly episodes?: (seasonId: string) => readonly Record<string, unknown>[];
}) => {
	const adapter: Partial<RyotClientAdapter> = {
		watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
		query: (document) => {
			const serialized = JSON.stringify(document);
			input.queries?.push(serialized);
			if (serialized.includes('"orderGroupShow"')) {
				return Promise.resolve({
					data: {
						coverage: rows([
							{
								episodeTotal: 2,
								watchedTotal: 1,
								upcomingTotal: 0,
								watchedMinutes: 66,
								watchedUnknownRuntime: 0,
							},
						]),
					},
				});
			}
			if (serialized.includes('"orderEpisode"')) {
				return Promise.resolve({
					data: {
						episodes: rows(
							orderEpisodeRows.filter(({ externalId }) => serialized.includes(`"${externalId}"`)),
						),
					},
				});
			}
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
							populationStatus: "ready",
							translationStatus: "none",
							episodeOrders: input.episodeOrders ?? null,
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

const STORAGE_ENTRY = "media:episode-order:show-1";

const textOf = (container: HTMLElement, text: string) =>
	Array.from(container.querySelectorAll("*")).find((element) => element.textContent === text);

const radio = (container: HTMLElement, label: string) =>
	Array.from(container.querySelectorAll('[role="radio"]')).find(
		(element) => element.textContent === label,
	);

const radioLabels = (container: HTMLElement, group: string) =>
	Array.from(
		container.querySelectorAll(`[role="radiogroup"][aria-label="${group}"] [role="radio"]`),
	).map((element) => element.textContent);

const click = async (element: Element | undefined) => {
	if (element === undefined) {
		throw new Error("Expected an element to click");
	}
	fireEvent.click(element);
	await flushRyotClient();
};

const episodeNames = (container: HTMLElement) =>
	Array.from(container.querySelectorAll('button[aria-label^="Open "]')).map((element) =>
		element.getAttribute("aria-label"),
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

describe("show episode orders", () => {
	it("hides the order picker when the show has no episode orders", async () => {
		const view = renderTab(showAdapter({}));
		await flushRyotClient();

		await waitFor(() => expect(view.container.textContent).toContain("Episode 1: The Arrest"));
		expect(view.container.querySelector('[aria-label="Episode order"]')).toBeNull();
		view.unmount();
	});

	it("restores the stored order before querying the seasons", async () => {
		const storage = createTestPluginStorage([[STORAGE_ENTRY, "order-dvd"]]);
		const pending: (() => void)[] = [];
		const queries: string[] = [];
		const view = renderTab({
			...showAdapter({ queries, episodeOrders: [dvdOrder] }),
			accessStorage: (request) =>
				new Promise((resolve) => {
					pending.push(() => resolve(storage.accessStorage(request)));
				}),
		});
		await flushRyotClient();

		expect(view.container.textContent).toContain("Restoring your episode order.");
		expect(queries).toEqual([]);

		pending.forEach((resume) => resume());
		await flushRyotClient();

		await waitFor(() => expect(view.container.textContent).toContain("Episode 1"));
		expect(radio(view.container, "DVD Order")?.getAttribute("aria-checked")).toBe("true");
		expect(radioLabels(view.container, "Episode group")).toEqual(["Volume 1", "Volume 2"]);
		view.unmount();
	});

	it("shows the picked order's groups with episodes in the group's order", async () => {
		const storage = createTestPluginStorage();
		const view = renderTab({
			...showAdapter({ episodeOrders: [dvdOrder, absoluteOrder] }),
			accessStorage: storage.accessStorage,
		});
		await flushRyotClient();
		await waitFor(() => expect(view.container.textContent).toContain("Episode 1: The Arrest"));

		expect(radioLabels(view.container, "Episode order")).toEqual([
			"Aired order",
			"DVD Order",
			"Absolute Order",
		]);
		expect(radio(view.container, "Aired order")?.getAttribute("aria-checked")).toBe("true");

		await click(radio(view.container, "DVD Order"));

		await waitFor(() =>
			expect(episodeNames(view.container)).toEqual(["Open Episode 3", "Open Episode 1"]),
		);
		expect(storage.entries.get(STORAGE_ENTRY)).toBe("order-dvd");
		expect(view.container.querySelector('[aria-label="Season"]')).toBeNull();
		expect(textOf(view.container, "Volume 1")).not.toBeUndefined();
		expect(textOf(view.container, "S1 • E3")).not.toBeUndefined();
		expect(textOf(view.container, "1/2 aired")).not.toBeUndefined();

		await click(radio(view.container, "Volume 2"));

		await waitFor(() => expect(episodeNames(view.container)).toEqual(["Open Episode 2"]));
		view.unmount();
	});

	it("leaves next up to aired order and forgets the order when aired order is picked", async () => {
		const storage = createTestPluginStorage([[STORAGE_ENTRY, "order-dvd"]]);
		const view = renderTab(
			{ ...showAdapter({ episodeOrders: [dvdOrder] }), accessStorage: storage.accessStorage },
			summaryNextUp,
		);
		await flushRyotClient();
		await waitFor(() => expect(view.container.textContent).toContain("Episode 3"));

		expect(view.container.textContent).not.toContain("Next up");

		await click(radio(view.container, "Aired order"));

		await waitFor(() => expect(view.container.textContent).toContain("Next up"));
		expect(storage.entries.has(STORAGE_ENTRY)).toBe(false);
		view.unmount();
	});

	it("falls back to aired order and forgets a stored order the show no longer offers", async () => {
		const storage = createTestPluginStorage([[STORAGE_ENTRY, "order-gone"]]);
		const view = renderTab({
			...showAdapter({ episodeOrders: [dvdOrder] }),
			accessStorage: storage.accessStorage,
		});
		await flushRyotClient();

		await waitFor(() => expect(view.container.textContent).toContain("Episode 1: The Arrest"));
		expect(radio(view.container, "Aired order")?.getAttribute("aria-checked")).toBe("true");
		await waitFor(() => expect(storage.entries.has(STORAGE_ENTRY)).toBe(false));
		view.unmount();
	});

	it("loads more of a group past one page of episode ids", async () => {
		const storage = createTestPluginStorage([[STORAGE_ENTRY, "order-absolute"]]);
		const view = renderTab({
			...showAdapter({ episodeOrders: [absoluteOrder] }),
			accessStorage: storage.accessStorage,
		});
		await flushRyotClient();

		await waitFor(() => expect(episodeNames(view.container)).toHaveLength(60));
		expect(view.container.textContent).not.toContain("Episode 61");

		await click(
			Array.from(view.container.querySelectorAll("button")).find(
				(button) => button.textContent === "Load more",
			),
		);

		await waitFor(() => expect(episodeNames(view.container)).toHaveLength(61));
		expect(episodeNames(view.container).at(-1)).toBe("Open Episode 61");
		view.unmount();
	});
});
