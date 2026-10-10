import { Effect, Result } from "@ryot-app/client-sdk/effect";
import { afterEach, describe, expect, it } from "vitest";

import { animeRecipes } from "../../shared/anime-recipes";
import {
	decodeFlatOverview,
	FLAT_OVERVIEW_INPUT,
	flatPersonRow,
} from "../../tests/client/flat-media/overview-fixture";
import { decodeFlatPresentation } from "../../tests/client/flat-media/presentation-fixture";
import {
	decodeFlatSummary,
	FLAT_SUMMARY_INPUT,
} from "../../tests/client/flat-media/summary-fixture";
import { readyQueryResult, rowsResult } from "../../tests/client/query-result-fixture";
import { renderMediaScreenBody } from "../../tests/client/screen-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import {
	animePresentationFacts,
	animeProgressLabel,
	animeSchema,
	animeSummaryFacts,
} from "./schema";
import { animeUpcomingEpisodes, AnimeAiringScheduleSection } from "./sections";

const noopAdapter = { query: () => Effect.succeed({}) };

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
	listState: null,
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

const animeActivity = (
	events: readonly Record<string, unknown>[] = [PROGRESS_EVENT],
	completionCount = 1,
) =>
	Result.getOrThrow(
		animeRecipes
			.activityRecipe({ eventLimit: 60, entityId: "anime-1", collectionEventLimit: 60 })
			.decode({
				data: {
					events: rowsResult(events, { limit: 60, hasMore: false, nextCursor: null }),
					collectionEvents: rowsResult([], { limit: 60, hasMore: false, nextCursor: null }),
					totals: rowsResult(
						[
							{
								completionCount,
								unknownAmountCount: 0,
								consumedAmount: completionCount === 0 ? 0 : 24,
							},
						],
						{ limit: 1, hasMore: false, nextCursor: null },
					),
				},
			}),
	);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("anime schema", () => {
	it("lists the next episode and episode count facts and drops the unrecorded ones", () => {
		expect(animeSummaryFacts(animeSummary())).toEqual([
			expect.objectContaining({ icon: "clock", label: "Next episode" }),
			{ icon: "tv", value: "24", label: "Episodes" },
		]);
		expect(
			animeSummaryFacts(animeSummary({ episodes: null, airingSchedule: [AIRED_EPISODE] })),
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

	it("renders a list-state snapshot as an observation with position and repeat metadata", () => {
		const activity = animeActivity(
			[
				{
					text: null,
					rating: null,
					timeSpent: null,
					startedOn: null,
					isSpoiler: null,
					animeEpisode: 0,
					consumedOn: null,
					completedOn: null,
					progressPercent: null,
					id: "anime-list-state",
					eventSchemaSlug: "list-state",
					createdAt: "2026-05-02T10:00:05.000Z",
					occurredAt: "2026-05-02T10:00:00.000Z",
					listState: {
						repeatCount: 2,
						animeEpisode: 0,
						source: "anilist",
						state: "in_progress",
						sourceEntryId: "entry-1",
						sourceAccountId: "account-1",
						sourceUpdatedAt: "2026-05-01T10:00:00.000Z",
					},
				},
			],
			0,
		);
		const view = animeSchema.activityView(activity);
		expect(view?.summary.completions).toBe(0);
		expect(view?.summary.amount).toEqual({ total: 0, missing: 0 });

		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<animeSchema.Activity
				compact
				refresh={() => undefined}
				state={animeSchema.mapActivity(readyQueryResult(activity))}
			/>,
		);
		expect(container.textContent).toContain("Synced from AniList");
		expect(container.textContent).toContain("In progress");
		expect(container.textContent).toContain("Episode 0");
		expect(container.textContent).toContain("Repeat count 2");
		expect(container.textContent).not.toContain("Finished the anime");
		unmount();
	});

	it("names the credit rails for an anime and never claims it is part of a series", () => {
		const { unmount, container } = renderMediaScreenBody(
			animeSchema,
			animeSummary(),
			decodeFlatOverview(animeRecipes.overviewRecipe(FLAT_OVERVIEW_INPUT)),
		);

		expect(container.textContent).toContain("Studios");
		expect(container.textContent).toContain("Cast & crew");
		expect(container.textContent).toContain(flatPersonRow.name);
		expect(container.textContent).not.toContain("Part of");
		unmount();
	});

	it("reads the episode count on cards and hints how much was watched", () => {
		const data = decodeFlatPresentation(animeRecipes, {
			episodes: 24,
			progressPercent: 62,
			schemaSlug: "anime",
		});

		expect(animePresentationFacts(data)).toEqual(["24 episodes"]);
		expect(animePresentationFacts({ ...data, episodes: 1 })).toEqual(["1 episode"]);
		expect(animePresentationFacts({ ...data, episodes: null })).toEqual([]);
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<animeSchema.CardContent compact data={data} entityId="media-1" />,
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
