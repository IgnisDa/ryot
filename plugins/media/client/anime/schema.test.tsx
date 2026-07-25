import { Result } from "@ryot-app/client-sdk/effect";
import { afterEach, describe, expect, it } from "vitest";

import { animeRecipes } from "../../shared/anime-recipes";
import {
	decodeFlatOverview,
	FLAT_OVERVIEW_INPUT,
	flatPersonRow,
} from "../../tests/client/flat-media/overview-fixture";
import {
	decodeFlatSummary,
	FLAT_SUMMARY_INPUT,
} from "../../tests/client/flat-media/summary-fixture";
import { readyQueryResult, rowsResult } from "../../tests/client/query-result-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { mapMediaOverview } from "../media/overview-state";
import {
	animePresentationFacts,
	animeProgressLabel,
	animeSchema,
	animeSummaryFacts,
} from "./schema";
import { animeUpcomingEpisodes, AnimeAiringScheduleSection } from "./sections";

const noopAdapter = { query: () => Promise.resolve({}) };

const AIRED_EPISODE = { episode: 1, airingAt: "2000-04-08T16:30:00.000Z" };

const UPCOMING_EPISODES = Array.from({ length: 8 }, (_, index) => ({
	episode: index + 2,
	airingAt: `2099-0${index + 1}-08T16:30:00.000Z`,
}));

const PROGRESS_EVENT = {
	text: null,
	rating: null,
	timeSpent: null,
	startedOn: null,
	isSpoiler: null,
	animeEpisode: 12,
	completedOn: null,
	progressPercent: 62,
	id: "anime-progress",
	consumedOn: "Crunchyroll",
	eventSchemaSlug: "progress",
	createdAt: "2025-11-03T12:00:05.000Z",
	occurredAt: "2025-11-03T12:00:00.000Z",
};

const animeSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(animeRecipes.summaryRecipe(FLAT_SUMMARY_INPUT), {
		episodes: 24,
		airingSchedule: [AIRED_EPISODE, ...UPCOMING_EPISODES],
		...overrides,
	});

const animeActivity = (events: readonly Record<string, unknown>[] = [PROGRESS_EVENT]) =>
	Result.getOrThrow(
		animeRecipes
			.activityRecipe({ eventLimit: 60, entityId: "anime-1", collectionEventLimit: 60 })
			.decode({
				data: {
					events: rowsResult(events, { limit: 60, hasMore: false, nextCursor: null }),
					collectionEvents: rowsResult([], { limit: 60, hasMore: false, nextCursor: null }),
					totals: rowsResult([{ completionCount: 1, consumedAmount: 24, unknownAmountCount: 0 }], {
						limit: 1,
						hasMore: false,
						nextCursor: null,
					}),
				},
			}),
	);

const presentationData = (overrides: Record<string, unknown> = {}) => {
	const decoded = animeRecipes
		.presentationRecipe(["anime-1"])
		.decode({
			data: {
				rows: rowsResult(
					[
						{
							images: null,
							episodes: 24,
							id: "anime-1",
							publishDate: null,
							publishYear: 2013,
							schemaSlug: "anime",
							progressPercent: 62,
							state: "in_progress",
							productionStatus: null,
							name: "Attack on Titan",
							populationStatus: "ready",
							translationStatus: "none",
							...overrides,
						},
					],
					{ limit: 100, hasMore: false, nextCursor: null },
				),
			},
		});
	if (decoded._tag === "Failure" || decoded.success[0] === undefined) {
		throw new Error("Expected decoded presentation data");
	}
	return { ...decoded.success[0], batchAssets: [] };
};

const renderBody = () =>
	mountRyotClient(
		noopAdapter,
		<animeSchema.ScreenBody
			compact
			activity={null}
			safeAreaTop={0}
			settled={undefined}
			refresh={() => undefined}
			refreshOverview={() => undefined}
			state={{ status: "ready", summary: animeSummary() }}
			overview={mapMediaOverview(
				readyQueryResult(decodeFlatOverview(animeRecipes.overviewRecipe(FLAT_OVERVIEW_INPUT))),
			)}
		/>,
	);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("anime schema", () => {
	it("lists the next episode and episode count facts and drops the unrecorded ones", () => {
		expect(animeSummaryFacts(animeSummary())).toEqual([
			expect.objectContaining({ label: "TMDB rating" }),
			expect.objectContaining({ icon: "clock", label: "Next episode" }),
			{ icon: "tv", value: "24", label: "Episodes" },
			{ value: "Released", icon: "clapperboard", label: "Production status" },
		]);
		expect(
			animeSummaryFacts(
				animeSummary({
					episodes: null,
					providerRating: null,
					productionStatus: null,
					airingSchedule: [AIRED_EPISODE],
				}),
			),
		).toEqual([]);
	});

	it("names the episode a progress event recorded, and falls back to the percent", () => {
		expect(animeProgressLabel("62", { animeEpisode: 12 })).toBe("Episode 12");
		expect(animeProgressLabel("62", { animeEpisode: null })).toBe("62% through the anime");
		expect(animeProgressLabel(undefined, { animeEpisode: null })).toBe(
			"Part-way through the anime",
		);
	});

	it("labels each recorded episode on its own activity row", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<animeSchema.Activity
				compact
				refresh={() => undefined}
				state={animeSchema.mapActivity(
					readyQueryResult(
						animeActivity([
							PROGRESS_EVENT,
							{
								...PROGRESS_EVENT,
								animeEpisode: 13,
								id: "anime-progress-13",
								createdAt: "2025-11-04T12:00:05.000Z",
								occurredAt: "2025-11-04T12:00:00.000Z",
							},
						]),
					),
				)}
			/>,
		);

		expect(container.textContent).toContain("Episode 12");
		expect(container.textContent).toContain("Episode 13");
		expect(container.textContent).not.toContain("62% through the anime");
		expect(container.textContent).toContain("Episodes");
		expect(container.textContent).toContain("24");
		unmount();
	});

	it("names the credit rails for an anime and never claims it is part of a series", () => {
		const { unmount, container } = renderBody();

		expect(container.textContent).toContain("Studios");
		expect(container.textContent).toContain("Cast & crew");
		expect(container.textContent).toContain(flatPersonRow.name);
		expect(container.textContent).not.toContain("Part of");
		unmount();
	});

	it("reads the episode count on cards and hints how much was watched", () => {
		const data = presentationData();

		expect(animePresentationFacts(data)).toEqual(["24 episodes"]);
		expect(animePresentationFacts({ ...data, episodes: 1 })).toEqual(["1 episode"]);
		expect(animePresentationFacts({ ...data, episodes: null })).toEqual([]);
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<animeSchema.CardContent compact data={data} entityId="anime-1" />,
		);
		expect(container.textContent).toContain("24 episodes");
		expect(container.textContent).toContain("62% watched");
		unmount();
	});

	it("shows only the episodes still to air, soonest first and capped", () => {
		expect(
			animeUpcomingEpisodes([AIRED_EPISODE, ...UPCOMING_EPISODES].toReversed()).map(
				({ episode }) => episode,
			),
		).toEqual([2, 3, 4, 5, 6, 7]);

		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<AnimeAiringScheduleSection
				compact
				divided={false}
				schedule={[AIRED_EPISODE, ...UPCOMING_EPISODES]}
			/>,
		);
		expect(container.textContent).toContain("Airing schedule");
		expect(container.textContent).toContain("Episode 2");
		expect(container.textContent).not.toContain("Episode 1");
		expect(container.textContent).not.toContain("Episode 8");
		unmount();
	});

	it("renders no airing section when every episode has aired", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<AnimeAiringScheduleSection compact divided={false} schedule={[AIRED_EPISODE]} />,
		);

		expect(container.textContent).toBe("");
		unmount();
	});
});
