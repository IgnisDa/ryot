import { afterEach, describe, expect, test } from "bun:test";

import { type EntityWatch, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { RyotQueryResult } from "@ryot-app/plugin-client-sdk/react";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";

import {
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import {
	episodicByLifecycleStateRecipe,
	flatByLifecycleStateRecipe,
} from "../../shared/lifecycle-list-recipes";
import { upcomingRecipe } from "../../shared/upcoming-recipes";
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
import { flushRyotClient, localDateTime, mountRyotClient } from "../../tests/client/test-support";
import { BacklogRail } from "./backlog-rail";
import { ContinueRail } from "./continue-rail";
import { SuggestionsRail } from "./suggestions-rail";
import { TrendingRail } from "./trending-rail";
import { UpcomingRail } from "./upcoming-rail";
import { useLocalToday } from "./use-local-today";

const noopAdapter = { query: () => Effect.succeed({}) };

const localNoon = (septemberDay: number) =>
	DateTime.formatIso(localDateTime({ hour: 12, month: 9, year: 2026, day: septemberDay }));

const libraryData = (input: {
	readonly flat?: readonly unknown[];
	readonly show?: readonly unknown[];
	readonly podcast?: readonly unknown[];
}) => ({
	flat: decodeRecipe(
		flatByLifecycleStateRecipe({ limit: 20, states: ["in_progress"], reference: { kind: "self" } }),
		{ items: rows(input.flat ?? []) },
	),
	show: decodeRecipe(
		episodicByLifecycleStateRecipe({
			limit: 20,
			states: ["in_progress"],
			reference: { kind: "self" },
			config: showEpisodicKindConfig,
		}),
		{ items: rows(input.show ?? []) },
	),
	podcast: decodeRecipe(
		episodicByLifecycleStateRecipe({
			limit: 20,
			states: ["in_progress"],
			reference: { kind: "self" },
			config: podcastEpisodicKindConfig,
		}),
		{ items: rows(input.podcast ?? []) },
	),
});

type UpcomingEpisodic = {
	readonly id: string;
	readonly total: number;
	readonly rows: readonly unknown[];
};

const upcomingTotals = (titles: readonly UpcomingEpisodic[]) => ({
	type: "aggregate",
	items: titles.map(({ id, total }) => ({ id, total })),
	pageInfo: { limit: 1000, hasMore: false, nextCursor: null },
});

const upcomingData = (input: {
	readonly onePerTitle?: boolean;
	readonly anime?: readonly unknown[];
	readonly releases?: readonly unknown[];
	readonly shows?: readonly UpcomingEpisodic[];
	readonly podcasts?: readonly UpcomingEpisodic[];
}) => ({
	titles: decodeRecipe(
		upcomingRecipe({
			limit: 20,
			fromDate: "",
			untilDate: "",
			fromInstant: "",
			untilInstant: "",
			reference: { kind: "self" },
			onePerTitle: input.onePerTitle ?? true,
		}),
		{
			anime: rows(input.anime ?? []),
			releases: rows(input.releases ?? []),
			showTotals: upcomingTotals(input.shows ?? []),
			podcastTotals: upcomingTotals(input.podcasts ?? []),
			shows: rows((input.shows ?? []).flatMap((title) => title.rows)),
			podcasts: rows((input.podcasts ?? []).flatMap((title) => title.rows)),
		},
	),
});

const tileLines = (container: HTMLElement) =>
	Array.from(container.querySelectorAll("a[aria-label]"), (tile) => [
		tile.getAttribute("aria-label"),
		...Array.from(tile.querySelectorAll(":scope > span, :scope > p"), (line) => line.textContent),
		...Array.from(tile.querySelectorAll(":scope > div span"), (badge) => badge.textContent),
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
					progressPercent: 40,
					position: { position: 12, unit: "episodes" },
					latestActivityAt: "2026-09-24T10:00:00.000Z",
				}),
				flatRow("manga-1", "Berserk", "manga", {
					latestActivityAt: "2026-09-22T10:00:00.000Z",
					position: { volume: 3, position: 21, unit: "chapters" },
				}),
				flatRow("manga-2", "Vagabond", "manga", {
					position: { position: 7, unit: "chapters" },
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
			["Open Frieren", "Frieren", "Ep 12"],
			["Open Hardcore History", "Hardcore History", "Resume · 2 days ago"],
			["Open Berserk", "Berserk", "Ch 21 · Vol 3"],
			["Open Vagabond", "Vagabond", "Ch 7"],
			["Open Heat", "Heat", "42%"],
			["Open The Rest Is History", "The Rest Is History", "The Fall of Rome", "Ep 71"],
		]);
		expect(view.container.querySelector('[aria-label="In your library"]')).toBeNull();
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
	test.each(rails)("$title shows a placeholder while pending", ({ title, render }) => {
		const view = mountRyotClient(noopAdapter, render(pendingQueryResult()));
		expect(view.container.querySelector(`[aria-label="Loading ${title}"]`)).not.toBeNull();
		view.unmount();
	});

	test.each(rails)("$title retries its own section after an error", ({ render }) => {
		let retries = 0;
		const failed = {
			...errorQueryResult<ReturnType<typeof libraryData>>(
				new RyotClientError({ reason: "transport" }),
			),
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

	test.each(rails)("$title hides itself when empty", ({ empty, render }) => {
		const view = mountRyotClient(noopAdapter, render(readyQueryResult(empty())));
		expect(view.container.textContent).toBe("");
		view.unmount();
	});
});

const upcomingEpisode = (
	id: string,
	publishDate: string,
	seasonNumber: null | number,
	episodeNumber: number,
	still = true,
) => ({
	id,
	publishDate,
	seasonNumber,
	episodeNumber,
	images: still ? [{ type: "remote", purpose: "still", url: "https://images.test/still.jpg" }] : [],
});

const upcomingEpisodic = (
	identity: ReturnType<typeof mediaIdentity>,
	total: number,
	episodes: readonly ReturnType<typeof upcomingEpisode>[],
): UpcomingEpisodic => ({
	total,
	id: identity.id,
	rows: episodes.map(({ id, images, ...episode }) => ({
		...identity,
		...episode,
		occurrenceId: id,
		occurrenceImages: images,
	})),
});

const severance = mediaIdentity("show-1", "Severance", "show");

const upcomingShow = (total: number, episodes: readonly ReturnType<typeof upcomingEpisode>[]) =>
	upcomingEpisodic(severance, total, episodes);

const upcomingAnime = (id: string, name: string, airings: readonly string[]) => ({
	...mediaIdentity(id, name, "anime"),
	total: airings.length,
	occurrences: includeResult(
		airings.map((airingAt, index) => ({ airingAt, episodeNumber: index + 4 })),
	),
});

function UpcomingToday(props: {
	readonly onePerTitle: boolean;
	readonly data: ReturnType<typeof upcomingData>;
}) {
	return (
		<UpcomingRail
			compact
			today={useLocalToday()}
			onePerTitle={props.onePerTitle}
			result={readyQueryResult(props.data)}
		/>
	);
}

describe("UpcomingRail", () => {
	test.each([
		{ still: true, backdrop: true, expected: "still" },
		{ still: false, backdrop: true, expected: "backdrop" },
		{ still: false, backdrop: false, expected: "show-1" },
	])(
		"uses $expected artwork with still=$still and backdrop=$backdrop",
		({ still, backdrop, expected }) => {
			const data = upcomingData({
				shows: [
					upcomingEpisodic(
						{
							...severance,
							images: [
								...severance.images,
								...(backdrop
									? [
											{
												type: "remote",
												purpose: "backdrop",
												url: "https://images.test/backdrop.jpg",
											},
										]
									: []),
							],
						},
						1,
						[upcomingEpisode("episode-1", "2026-09-26", 2, 10, still)],
					),
				],
			});
			const view = mountRyotClient(
				noopAdapter,
				<UpcomingRail compact onePerTitle today="2026-09-25" result={readyQueryResult(data)} />,
			);

			expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
				`https://images.test/${expected}.jpg`,
			);
			view.unmount();
		},
	);

	it.live(
		"merges every source by local day and recaptions them at local midnight",
		() =>
			Effect.gen(function* () {
				const mondayMorning = DateTime.formatIso(
					localDateTime({ day: 28, hour: 10, month: 9, year: 2026 }),
				);
				const data = upcomingData({
					anime: [upcomingAnime("anime-1", "Frieren", [mondayMorning])],
					shows: [upcomingShow(3, [upcomingEpisode("episode-1", "2026-09-26", 2, 10)])],
					releases: [{ ...mediaIdentity("movie-1", "Dune", "movie"), publishDate: "2026-10-05" }],
					podcasts: [
						upcomingEpisodic(mediaIdentity("podcast-1", "Hardcore History", "podcast"), 1, [
							upcomingEpisode("podcast-ep", "2026-09-28", null, 71),
						]),
					],
				});
				const view = mountRyotClient(noopAdapter, null);
				yield* Effect.promise(() =>
					view.setTime(
						DateTime.toEpochMillis(
							localDateTime({ day: 25, hour: 23, month: 9, minute: 30, year: 2026 }),
						),
					),
				);
				view.rerender(<UpcomingToday onePerTitle data={data} />);

				expect(tileLines(view.container)).toEqual([
					["Open Severance", "Severance", "S2 E10", "Tomorrow · +2 more"],
					["Open Hardcore History", "Hardcore History", "Ep 71", "Monday"],
					["Open Frieren", "Frieren", "Ep 4", "Monday"],
					["Open Dune", "Dune", "Oct 5"],
				]);

				yield* Effect.promise(() => view.advance("30 minutes"));

				expect(tileLines(view.container).map((tile) => tile.at(-1))).toEqual([
					"Today · +2 more",
					"Monday",
					"Monday",
					"Oct 5",
				]);
				view.unmount();
			}),
		testTimeout,
	);

	it("keeps each title's soonest entry across sources and counts the rest", () => {
		const data = upcomingData({
			anime: [upcomingAnime("anime-1", "Frieren", ["2026-09-30T12:00:00.000Z"])],
			releases: [{ ...mediaIdentity("anime-1", "Frieren", "anime"), publishDate: "2026-09-27" }],
		});
		const view = mountRyotClient(
			noopAdapter,
			<UpcomingRail compact onePerTitle today="2026-09-25" result={readyQueryResult(data)} />,
		);

		expect(tileLines(view.container)).toEqual([["Open Frieren", "Frieren", "Sunday · +1 more"]]);
		view.unmount();
	});

	it("lists every occurrence when one entry per title is off", () => {
		const data = upcomingData({
			onePerTitle: false,
			shows: [
				upcomingShow(2, [
					upcomingEpisode("episode-1", "2026-09-26", 2, 10),
					upcomingEpisode("episode-2", "2026-10-03", 2, 11),
				]),
			],
		});
		const view = mountRyotClient(
			noopAdapter,
			<UpcomingRail
				compact
				today="2026-09-25"
				onePerTitle={false}
				result={readyQueryResult(data)}
			/>,
		);

		expect(tileLines(view.container)).toEqual([
			["Open Severance", "Severance", "S2 E10", "Tomorrow"],
			["Open Severance", "Severance", "S2 E11", "Oct 3"],
		]);
		view.unmount();
	});

	it("hides itself when nothing is upcoming in the window", () => {
		const view = mountRyotClient(
			noopAdapter,
			<UpcomingRail
				compact
				onePerTitle
				today="2026-09-25"
				result={readyQueryResult(upcomingData({}))}
			/>,
		);
		expect(view.container.textContent).toBe("");
		view.unmount();
	});
});

type QueryResponder = (queries: readonly string[]) => Effect.Effect<unknown, RyotClientError>;

const respondingAdapter = (respond: QueryResponder, interests: EntityWatch[] = []) => ({
	query: (document: { readonly queries: Readonly<Record<string, unknown>> }) =>
		respond(Object.keys(document.queries)),
	watchEntities: (interest: EntityWatch) => {
		interests.push(interest);
		return {
			dispose: () => undefined,
			update: (next: EntityWatch) => {
				interests.push(next);
			},
		};
	},
});

const respondWith =
	(data: Readonly<Record<string, unknown>>): QueryResponder =>
	(queries) =>
		Effect.succeed({ data: Object.fromEntries(queries.map((name) => [name, data[name]])) });

const trending = (id: string, name: string, schemaSlug: string, rank: number) => ({
	...mediaIdentity(id, name, schemaSlug),
	rank,
	isInMediaLibrary: false,
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
	test.each(lazyRails)("$title shows a placeholder while pending", ({ Rail, title }) => {
		const view = mountRyotClient(
			respondingAdapter(() => Effect.never),
			<Rail compact />,
		);
		expect(view.container.querySelector(`[aria-label="Loading ${title}"]`)).not.toBeNull();
		view.unmount();
	});

	it.live.each(lazyRails)(
		"$title offers a retry after an error",
		({ Rail }) =>
			Effect.gen(function* () {
				const view = mountRyotClient(
					respondingAdapter(() => Effect.fail(new RyotClientError({ reason: "transport" }))),
					<Rail compact />,
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(view.container.querySelector('[role="alert"]')).not.toBeNull()),
				);
				view.unmount();
			}),
		testTimeout,
	);

	it.live.each(lazyRails)(
		"$title hides itself when it has nothing to show",
		({ Rail, empty }) =>
			Effect.gen(function* () {
				const view = mountRyotClient(respondingAdapter(respondWith(empty)), <Rail compact />);
				yield* Effect.promise(() => flushRyotClient());
				yield* Effect.promise(() => waitFor(() => expect(view.container.textContent).toBe("")));
				view.unmount();
			}),
		testTimeout,
	);

	it.live(
		"titles suggestions after the completion they come from and watches both",
		() =>
			Effect.gen(function* () {
				const interests: EntityWatch[] = [];
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
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(view.container.querySelector("h2")?.textContent).toBe(
							"Because you finished Heat",
						),
					),
				);
				expect(tileLines(view.container)).toEqual([["Open Collateral", "Collateral"]]);
				expect(interests.at(-1)).toEqual({ foreground: [], visible: ["movie-1", "movie-2"] });
				view.unmount();
			}),
		testTimeout,
	);

	it.live(
		"numbers trending titles by rank",
		() =>
			Effect.gen(function* () {
				const view = mountRyotClient(
					respondingAdapter(
						respondWith({
							"trending.trending": rows([
								{ ...trending("movie-1", "Heat", "movie", 1), isInMediaLibrary: true },
								trending("show-1", "Severance", "show", 1),
								trending("movie-2", "Collateral", "movie", 2),
							]),
						}),
					),
					<TrendingRail compact />,
				);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(tileLines(view.container)).toEqual([
							["Open Heat", "Heat", "1"],
							["Open Severance", "Severance", "1"],
							["Open Collateral", "Collateral", "2"],
						]),
					),
				);
				expect(view.container.querySelectorAll('[aria-label="In your library"]')).toHaveLength(1);
				expect(
					getByRole(view.container, "link", { name: "Open Heat" }).querySelector(".text-warning"),
				).not.toBeNull();
				view.unmount();
			}),
		testTimeout,
	);
});
