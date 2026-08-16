import { assert, describe, expect, it } from "vitest";

import {
	decodeShowEpisodesResult,
	decodeShowSeasonEpisodesResult,
	showEpisodeRow,
	showSeasonRow,
} from "./episodes-fixture";
import {
	mapShowEpisodes,
	mapShowSeasonEpisodes,
	selectedShowSeason,
	showEpisodeAirDateLabel,
	showEpisodeRuntimeLabel,
	showEpisodeStateLabel,
	showEpisodeSynopsis,
	showEpisodesError,
	showEpisodesManagedAssets,
	showNextUpEpisode,
	showSeasonCompletedLabel,
	showSeasonCompletionPercent,
	showSeasonDescription,
	showSeasonEpisodeCountLabel,
	showSeasonLabel,
	showSeasonReleaseLabel,
} from "./episodes-state";
import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "./query-result-fixture";

type SeasonInput = Parameters<typeof decodeShowEpisodesResult>[0]["seasons"];
type SeasonEpisodesInput = Parameters<typeof decodeShowSeasonEpisodesResult>[0];

const episode = (overrides: Record<string, unknown>) => ({ ...showEpisodeRow, ...overrides });

const readySeasons = (seasons: SeasonInput) => {
	const state = mapShowEpisodes(readyQueryResult(decodeShowEpisodesResult({ seasons })));
	assert(state.status === "ready");
	return state.seasons;
};

const readySeasonEpisodes = (input: SeasonEpisodesInput = {}) => {
	const state = mapShowSeasonEpisodes(readyQueryResult(decodeShowSeasonEpisodesResult(input)));
	assert(state.status === "ready");
	return state.season;
};

const readyEpisodes = (input: SeasonEpisodesInput = {}) =>
	readySeasonEpisodes(input).episodes.items;

const specialsSeason = {
	...showSeasonRow,
	id: "season-0",
	seasonNumber: 0,
	name: "Specials",
};

describe("show episodes state", () => {
	it("maps a pending query to the loading state", () => {
		expect(mapShowEpisodes(pendingQueryResult())).toEqual({ status: "loading" });
	});

	it("maps a malformed decode failure apart from a transport failure", () => {
		expect(mapShowEpisodes(malformedQueryResult()).status).toBe("malformed");
		expect(mapShowEpisodes(transportErrorQueryResult()).status).toBe("transport-error");
	});

	it("maps a selected season response with its nested episodes", () => {
		const state = mapShowSeasonEpisodes(
			readyQueryResult(decodeShowSeasonEpisodesResult({ episodes: [showEpisodeRow] })),
		);

		expect(state).toMatchObject({
			status: "ready",
			season: { id: "season-1", episodes: { items: [{ id: "episode-1" }] } },
		});
	});

	it("keeps error copy free of decoder and transport internals", () => {
		expect(showEpisodesError({ status: "malformed" }).detail).not.toContain("RyotQL");
		expect(showEpisodesError({ status: "transport-error" })).toEqual({
			title: "Unable to load episodes",
			detail: "The seasons could not be loaded. Check your connection and try again.",
		});
	});

	it("reports a show without seasons or without a row as empty", () => {
		expect(mapShowEpisodes(readyQueryResult(decodeShowEpisodesResult({ seasons: [] })))).toEqual({
			status: "empty",
		});
		expect(mapShowEpisodes(readyQueryResult(decodeShowEpisodesResult({ show: null })))).toEqual({
			status: "empty",
		});
	});

	it("orders regular seasons ascending and keeps specials last", () => {
		const seasons = readySeasons([
			{ ...showSeasonRow, id: "season-2", seasonNumber: 2 },
			specialsSeason,
			showSeasonRow,
		]);

		expect(seasons.map((season) => season.id)).toEqual(["season-1", "season-2", "season-0"]);
	});

	it("labels season zero as specials and falls back to the season number", () => {
		const seasons = readySeasons([
			{ ...showSeasonRow, name: "" },
			{ ...specialsSeason, name: "Extras" },
		]);
		const [regular, specials] = seasons;
		assert(specials !== undefined);

		expect(showSeasonLabel(regular)).toBe("Season 1");
		expect(showSeasonLabel(specials)).toBe("Specials");
		expect(showSeasonLabel(readySeasons([showSeasonRow])[0])).toBe("Season 1");
	});

	it("defaults to the first regular season and to specials when nothing else exists", () => {
		const mixed = readySeasons([specialsSeason, showSeasonRow]);
		const onlySpecials = readySeasons([specialsSeason]);

		expect(selectedShowSeason(mixed, null).id).toBe("season-1");
		expect(selectedShowSeason(onlySpecials, null).id).toBe("season-0");
		expect(selectedShowSeason(mixed, "season-0").id).toBe("season-0");
		expect(selectedShowSeason(mixed, "season-9").id).toBe("season-1");
	});

	it("derives completion counts from the loaded episode lifecycle states", () => {
		const season = readySeasonEpisodes({
			episodes: [
				episode({ id: "episode-1", episodeNumber: 1, state: "complete" }),
				episode({ id: "episode-2", episodeNumber: 2, state: "in_progress" }),
				episode({ id: "episode-3", episodeNumber: 3, state: "untracked" }),
				episode({ id: "episode-4", episodeNumber: 4, state: "complete" }),
			],
		});

		expect(showSeasonEpisodeCountLabel(season)).toBe("4 episodes");
		expect(showSeasonCompletedLabel(season)).toBe("2 watched");
		expect(showSeasonCompletionPercent(season)).toBe(50);
	});

	it("never presents a partial season as an exact total", () => {
		const season = readySeasonEpisodes({
			hasMore: true,
			episodes: [episode({ state: "complete" })],
		});

		expect(showSeasonEpisodeCountLabel(season)).toBe("1+ episodes");
		expect(showSeasonCompletionPercent(season)).toBeUndefined();
	});

	it("omits counts and completion for a season with no loaded episodes", () => {
		const season = readySeasonEpisodes({ episodes: [] });

		expect(showSeasonEpisodeCountLabel(season)).toBeUndefined();
		expect(showSeasonCompletedLabel(season)).toBeUndefined();
		expect(showSeasonCompletionPercent(season)).toBeUndefined();
	});

	it("prefers an in-progress regular episode for next up", () => {
		const nextUp = showNextUpEpisode(
			readyEpisodes({
				episodes: [
					episode({ id: "episode-1", episodeNumber: 1, state: "complete" }),
					episode({ id: "episode-2", episodeNumber: 2, state: "untracked" }),
					episode({ id: "episode-3", episodeNumber: 3, state: "in_progress" }),
				],
			}),
		);

		expect(nextUp?.id).toBe("episode-3");
	});

	it("falls back to the first untracked episode after the completed ones", () => {
		const nextUp = showNextUpEpisode(
			readyEpisodes({
				episodes: [
					episode({ id: "episode-1", episodeNumber: 1, state: "complete" }),
					episode({ id: "episode-2", episodeNumber: 2, state: "untracked" }),
				],
			}),
		);

		expect(nextUp?.id).toBe("episode-2");
	});

	it("has no next up for an untracked or finished season", () => {
		expect(
			showNextUpEpisode(readyEpisodes({ episodes: [episode({ state: "untracked" })] })),
		).toBeUndefined();
		expect(
			showNextUpEpisode(readyEpisodes({ episodes: [episode({ state: "complete" })] })),
		).toBeUndefined();
	});

	it("formats the metadata providers recorded and omits the rest", () => {
		const [season] = readySeasons([showSeasonRow]);
		const [first, second] = readyEpisodes({
			episodes: [
				showEpisodeRow,
				episode({ id: "episode-2", runtime: null, publishDate: null, description: "  " }),
			],
		});
		assert(first !== undefined && second !== undefined);

		expect(showSeasonReleaseLabel(season)).toBe("Mar 13, 2025");
		expect(showSeasonDescription(season)).toBe("The complete limited series.");
		expect(showEpisodeAirDateLabel(first)).toBe("Mar 13, 2025");
		expect(showEpisodeRuntimeLabel(first)).toBe("66 min");
		expect(showEpisodeSynopsis(first)).toBe("A thirteen-year-old is arrested at dawn.");
		expect(showEpisodeAirDateLabel(second)).toBeUndefined();
		expect(showEpisodeRuntimeLabel(second)).toBeUndefined();
		expect(showEpisodeSynopsis(second)).toBeUndefined();
	});

	it("omits season metadata the provider left out", () => {
		const [season] = readySeasons([{ ...showSeasonRow, releaseDate: null, description: null }]);

		expect(showSeasonReleaseLabel(season)).toBeUndefined();
		expect(showSeasonDescription(season)).toBeUndefined();
	});

	it("keeps the lifecycle indicator quiet for untracked episodes", () => {
		expect(showEpisodeStateLabel("untracked")).toBeUndefined();
		expect(showEpisodeStateLabel("in_progress")).toBe("In progress");
		expect(showEpisodeStateLabel("complete")).toBe("Watched");
	});

	it("collects only the managed locators the episodes tab renders", () => {
		const seasons = readySeasons([
			{ ...showSeasonRow, images: [{ type: "s3", key: "season-cover", purpose: "cover" }] },
		]);
		const seasonEpisodes = mapShowSeasonEpisodes(
			readyQueryResult(
				decodeShowSeasonEpisodesResult({
					episodes: [
						episode({ images: [{ type: "local", key: "episode-still", purpose: "still" }] }),
						episode({ id: "episode-2", images: null }),
					],
				}),
			),
		);

		expect(showEpisodesManagedAssets(seasons, seasonEpisodes)).toEqual([
			{ type: "local", key: "episode-still" },
			{ type: "s3", key: "season-cover" },
		]);
	});
});
