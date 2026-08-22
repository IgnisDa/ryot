import { RyotClientError, type EntityInterest } from "@ryot-app/client-sdk";
import type { RyotQueryResult } from "@ryot-app/client-sdk/react";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { afterEach, assert, describe, expect, it } from "vitest";

import { animeAiringSoonRecipe, showsAiringSoonRecipe } from "../../shared/airing-recipes";
import {
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import {
	episodicByLifecycleStateRecipe,
	flatByLifecycleStateRecipe,
} from "../../shared/lifecycle-list-recipes";
import {
	decodeRecipe,
	episodicRow,
	flatRow,
	includeResult,
	mediaIdentity,
	nextUpRow,
	rows,
} from "../../tests/client/home/fixtures";
import {
	errorQueryResult,
	pendingQueryResult,
	readyQueryResult,
} from "../../tests/client/query-result-fixture";
import { flushRyotClient, mountRyotClient } from "../../tests/client/test-support";
import { AiringRail } from "./airing-rail";
import { BacklogRail } from "./backlog-rail";
import { ContinueRail } from "./continue-rail";
import { SuggestionsRail } from "./suggestions-rail";
import { TrendingRail } from "./trending-rail";
import { useLocalToday } from "./use-local-today";

const noopAdapter = { query: () => Promise.resolve({}) };

const localNoon = (septemberDay: number) => new Date(2026, 8, septemberDay, 12).toISOString();

const libraryData = (input: {
	readonly flat?: readonly unknown[];
	readonly show?: readonly unknown[];
	readonly podcast?: readonly unknown[];
}) => ({
	flat: decodeRecipe(flatByLifecycleStateRecipe({ limit: 20, states: ["in_progress"] }), {
		items: rows(input.flat ?? []),
	}),
	show: decodeRecipe(
		episodicByLifecycleStateRecipe({
			limit: 20,
			states: ["in_progress"],
			config: showEpisodicKindConfig,
		}),
		{ items: rows(input.show ?? []) },
	),
	podcast: decodeRecipe(
		episodicByLifecycleStateRecipe({
			limit: 20,
			states: ["in_progress"],
			config: podcastEpisodicKindConfig,
		}),
		{ items: rows(input.podcast ?? []) },
	),
});

const airingData = (input: {
	readonly shows?: readonly unknown[];
	readonly anime?: readonly unknown[];
}) => ({
	shows: decodeRecipe(showsAiringSoonRecipe({ from: "", until: "", limit: 20 }), {
		shows: rows(input.shows ?? []),
	}),
	anime: decodeRecipe(animeAiringSoonRecipe({ now: "", until: "", fromDate: "", untilDate: "" }), {
		anime: rows(input.anime ?? []),
	}),
});

const tileLines = (container: HTMLElement) =>
	Array.from(container.querySelectorAll("a[aria-label]"), (tile) => [
		tile.getAttribute("aria-label"),
		...Array.from(tile.querySelectorAll("p"), (line) => line.textContent),
		...Array.from(tile.querySelectorAll("span"), (badge) => badge.textContent),
	]);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("ContinueRail", () => {
	it("merges flat, show, and podcast items by latest activity and labels each tile", () => {
		const data = libraryData({
			show: [
				episodicRow(
					"show-1",
					"Severance",
					"show",
					"2026-09-25T09:00:00.000Z",
					nextUpRow(2, 5, "Trojan's Horse"),
				),
			],
			podcast: [
				episodicRow("podcast-1", "Hardcore History", "podcast", localNoon(23), null),
				episodicRow(
					"podcast-2",
					"The Rest Is History",
					"podcast",
					"2026-09-19T12:00:00.000Z",
					nextUpRow(null, 71, "The Fall of Rome"),
				),
			],
			flat: [
				flatRow("movie-1", "Heat", "movie", {
					progressPercent: 42.4,
					latestActivityAt: "2026-09-20T10:00:00.000Z",
				}),
				flatRow("anime-1", "Frieren", "anime", {
					animeEpisode: 12,
					progressPercent: 40,
					latestActivityAt: "2026-09-24T10:00:00.000Z",
				}),
				flatRow("manga-1", "Berserk", "manga", {
					mangaVolume: 3,
					mangaChapter: 21,
					latestActivityAt: "2026-09-22T10:00:00.000Z",
				}),
				flatRow("manga-2", "Vagabond", "manga", {
					mangaChapter: 7,
					latestActivityAt: "2026-09-21T10:00:00.000Z",
				}),
			],
		});

		const view = mountRyotClient(
			noopAdapter,
			<ContinueRail compact today="2026-09-25" result={readyQueryResult(data)} />,
		);

		expect(tileLines(view.container)).toEqual([
			["Open Severance", "Severance", "Trojan's Horse", "S2 E5"],
			["Open Frieren", "Frieren", "Episode 12"],
			["Open Hardcore History", "Hardcore History", "Resume · 2 days ago"],
			["Open Berserk", "Berserk", "Vol 3, Ch 21"],
			["Open Vagabond", "Vagabond", "Ch 7"],
			["Open Heat", "Heat", "42%"],
			["Open The Rest Is History", "The Rest Is History", "The Fall of Rome", "Ep 71"],
		]);
		view.unmount();
	});

	it("keeps only the twenty most recent items", () => {
		const flat = Array.from({ length: 12 }, (_, index) =>
			flatRow(`movie-${index}`, `Movie ${index}`, "movie", {
				latestActivityAt: `2026-09-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
			}),
		);
		const show = Array.from({ length: 12 }, (_, index) =>
			episodicRow(
				`show-${index}`,
				`Show ${index}`,
				"show",
				`2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
				null,
			),
		);
		const view = mountRyotClient(
			noopAdapter,
			<ContinueRail
				compact
				today="2026-09-25"
				result={readyQueryResult(libraryData({ flat, show }))}
			/>,
		);

		const names = tileLines(view.container).map(([label]) => label);
		expect(names).toHaveLength(20);
		expect(names[0]).toBe("Open Movie 11");
		expect(names.at(-1)).toBe("Open Show 4");
		view.unmount();
	});
});

const rails = [
	{
		title: "Continue",
		empty: () => libraryData({}),
		render: (result: RyotQueryResult<ReturnType<typeof libraryData>>) => (
			<ContinueRail compact result={result} today="2026-09-25" />
		),
	},
	{
		title: "From your backlog",
		empty: () => libraryData({}),
		render: (result: RyotQueryResult<ReturnType<typeof libraryData>>) => (
			<BacklogRail compact result={result} />
		),
	},
] as const;

describe("library rails", () => {
	it.each(rails)("$title shows a placeholder while pending", ({ title, render }) => {
		const view = mountRyotClient(noopAdapter, render(pendingQueryResult()));
		expect(view.container.querySelector(`[aria-label="Loading ${title}"]`)).not.toBeNull();
		view.unmount();
	});

	it.each(rails)("$title retries its own section after an error", ({ render }) => {
		let retries = 0;
		const failed = {
			...errorQueryResult<ReturnType<typeof libraryData>>(new RyotClientError("transport")),
			refetch: () => {
				retries += 1;
			},
		};
		const view = mountRyotClient(noopAdapter, render(failed));
		const alert = view.container.querySelector('[role="alert"]');
		assert(alert instanceof HTMLElement);
		fireEvent.click(getByRole(alert, "button", { name: "Try again" }));
		expect(retries).toBe(1);
		view.unmount();
	});

	it.each(rails)("$title hides itself when empty", ({ empty, render }) => {
		const view = mountRyotClient(noopAdapter, render(readyQueryResult(empty())));
		expect(view.container.textContent).toBe("");
		view.unmount();
	});
});

const airingShow = (publishDate: string, sameDayCount: number) => ({
	...mediaIdentity("show-1", "Severance", "show"),
	episode: includeResult([
		{
			...mediaIdentity("episode-1", "Cold Harbor", "show-episode"),
			publishDate,
			sameDayCount,
			seasonNumber: 2,
			episodeNumber: 10,
			images: [{ type: "remote", purpose: "still", url: "https://images.test/still.jpg" }],
		},
	]),
});

const airingAnime = (id: string, name: string, airingAt: string, publishDate: string | null) => ({
	...mediaIdentity(id, name, "anime"),
	publishDate,
	nextEpisode: 4,
	nextAiringAt: airingAt,
	airingSchedule: [{ airingAt, episode: 4 }],
});

function AiringToday(props: { readonly data: ReturnType<typeof airingData> }) {
	return <AiringRail compact today={useLocalToday()} result={readyQueryResult(props.data)} />;
}

describe("AiringRail", () => {
	it("merges shows and anime by local day and recaptions them at local midnight", async () => {
		const mondayMorning = new Date(2026, 8, 28, 10).toISOString();
		const data = airingData({
			shows: [airingShow("2026-09-26", 3)],
			anime: [
				airingAnime("anime-1", "Frieren", mondayMorning, null),
				airingAnime("anime-2", "Dandadan", "2026-10-05T00:00:00.000Z", "2026-10-05"),
			],
		});
		const view = mountRyotClient(noopAdapter, null);
		await view.setTime(new Date(2026, 8, 25, 23, 30).getTime());
		view.rerender(<AiringToday data={data} />);

		expect(tileLines(view.container)).toEqual([
			["Open Severance", "Severance", "S2 E10", "Tomorrow · +2 more"],
			["Open Frieren", "Frieren", "Episode 4", "Monday"],
			["Open Dandadan", "Dandadan", "Episode 4", "Oct 5"],
		]);
		expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
			"https://images.test/still.jpg",
		);

		await view.advance("30 minutes");

		expect(tileLines(view.container).map((tile) => tile.at(-1))).toEqual([
			"Today · +2 more",
			"Monday",
			"Oct 5",
		]);
		view.unmount();
	});

	it("hides itself when nothing airs in the window", () => {
		const view = mountRyotClient(
			noopAdapter,
			<AiringRail compact today="2026-09-25" result={readyQueryResult(airingData({}))} />,
		);
		expect(view.container.textContent).toBe("");
		view.unmount();
	});
});

type QueryResponder = (queries: readonly string[]) => Promise<unknown>;

const respondingAdapter = (respond: QueryResponder, interests: EntityInterest[] = []) => ({
	query: (document: { readonly queries: Readonly<Record<string, unknown>> }) =>
		respond(Object.keys(document.queries)),
	watchEntities: (interest: EntityInterest) => {
		interests.push(interest);
		return {
			dispose: () => undefined,
			update: (next: EntityInterest) => {
				interests.push(next);
			},
		};
	},
});

const respondWith =
	(data: Readonly<Record<string, unknown>>): QueryResponder =>
	(queries) =>
		Promise.resolve({ data: Object.fromEntries(queries.map((name) => [name, data[name]])) });

const trending = (id: string, name: string, schemaSlug: string, rank: number) => ({
	...mediaIdentity(id, name, schemaSlug),
	rank,
	fetchedAt: "2026-09-25T00:00:00.000Z",
});

const lazyRails = [
	{
		Rail: SuggestionsRail,
		title: "Because you finished",
		empty: { "suggestions.items": rows([]), "suggestions.source": rows([]) },
	},
	{
		Rail: TrendingRail,
		title: "Trending in films & shows",
		empty: { "trending.trending": rows([]) },
	},
] as const;

describe("lazily queried rails", () => {
	it.each(lazyRails)("$title shows a placeholder while pending", ({ Rail, title }) => {
		const view = mountRyotClient(
			respondingAdapter(() => new Promise(() => undefined)),
			<Rail compact />,
		);
		expect(view.container.querySelector(`[aria-label="Loading ${title}"]`)).not.toBeNull();
		view.unmount();
	});

	it.each(lazyRails)("$title offers a retry after an error", async ({ Rail }) => {
		const view = mountRyotClient(
			respondingAdapter(() => Promise.reject(new Error("offline"))),
			<Rail compact />,
		);
		await waitFor(() => expect(view.container.querySelector('[role="alert"]')).not.toBeNull());
		view.unmount();
	});

	it.each(lazyRails)("$title hides itself when it has nothing to show", async ({ Rail, empty }) => {
		const view = mountRyotClient(respondingAdapter(respondWith(empty)), <Rail compact />);
		await flushRyotClient();
		await waitFor(() => expect(view.container.textContent).toBe(""));
		view.unmount();
	});

	it("titles suggestions after the completion they come from and watches both", async () => {
		const interests: EntityInterest[] = [];
		const view = mountRyotClient(
			respondingAdapter(
				respondWith({
					"suggestions.source": rows([mediaIdentity("movie-1", "Heat", "movie")]),
					"suggestions.items": rows([mediaIdentity("movie-2", "Collateral", "movie")]),
				}),
				interests,
			),
			<SuggestionsRail compact />,
		);
		await waitFor(() =>
			expect(view.container.querySelector("h2")?.textContent).toBe("Because you finished Heat"),
		);
		expect(tileLines(view.container)).toEqual([["Open Collateral", "Collateral"]]);
		expect(interests.at(-1)).toEqual({ foreground: [], visible: ["movie-1", "movie-2"] });
		view.unmount();
	});

	it("numbers trending titles by rank", async () => {
		const view = mountRyotClient(
			respondingAdapter(
				respondWith({
					"trending.trending": rows([
						trending("movie-1", "Heat", "movie", 1),
						trending("show-1", "Severance", "show", 1),
						trending("movie-2", "Collateral", "movie", 2),
					]),
				}),
			),
			<TrendingRail compact />,
		);
		await waitFor(() =>
			expect(tileLines(view.container)).toEqual([
				["Open Heat", "Heat", "1"],
				["Open Severance", "Severance", "1"],
				["Open Collateral", "Collateral", "2"],
			]),
		);
		view.unmount();
	});
});
