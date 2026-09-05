import { afterEach, describe, expect, it } from "vitest";

import {
	videoGameOverviewRecipe,
	videoGamePresentationRecipe,
	videoGameSummaryRecipe,
} from "../../shared/video-game-recipes";
import { decodeFlatActivity } from "../../tests/client/flat-media/activity-fixture";
import {
	decodeFlatOverview,
	FLAT_OVERVIEW_INPUT,
} from "../../tests/client/flat-media/overview-fixture";
import {
	decodeFlatSummary,
	FLAT_SUMMARY_INPUT,
} from "../../tests/client/flat-media/summary-fixture";
import { readyQueryResult, rowsResult } from "../../tests/client/query-result-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { mapMediaOverview } from "../media/overview-state";
import { videoGamePresentationFacts, videoGameSchema, videoGameSummaryFacts } from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const videoGameFields = {
	timeToBeat: { hastily: 600, normally: 900, completely: 1500 },
	platformReleases: [
		{ name: "PlayStation 5", releaseDate: "2022-02-25", releaseRegion: "Worldwide" },
		{ name: "PC" },
	],
};

const videoGameSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(videoGameSummaryRecipe(FLAT_SUMMARY_INPUT), {
		...videoGameFields,
		...overrides,
	});

const renderBody = (overrides: Record<string, unknown> = {}) =>
	mountRyotClient(
		noopAdapter,
		<videoGameSchema.ScreenBody
			compact
			safeAreaTop={0}
			settled={undefined}
			refresh={() => undefined}
			refreshOverview={() => undefined}
			state={{ status: "ready", summary: videoGameSummary(overrides) }}
			overview={mapMediaOverview(
				readyQueryResult(decodeFlatOverview(videoGameOverviewRecipe(FLAT_OVERVIEW_INPUT))),
			)}
			activity={
				<videoGameSchema.Activity
					compact
					refresh={() => undefined}
					state={videoGameSchema.mapActivity(readyQueryResult(decodeFlatActivity()))}
				/>
			}
		/>,
	);

const presentationData = (timeToBeatNormally: number | null) => {
	const decoded = videoGamePresentationRecipe(["media-1"]).decode({
		data: {
			rows: rowsResult(
				[
					{
						images: null,
						id: "media-1",
						publishDate: null,
						publishYear: 2022,
						timeToBeatNormally,
						name: "Elden Ring",
						progressPercent: 42,
						state: "in_progress",
						schemaSlug: "video-game",
						populationStatus: "ready",
						translationStatus: "none",
						productionStatus: "Released",
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

afterEach(() => {
	document.body.innerHTML = "";
});

describe("video game schema", () => {
	it("lists the rating, time to beat and production status and drops the unrecorded ones", () => {
		expect(videoGameSummaryFacts(videoGameSummary())).toEqual([
			expect.objectContaining({ label: "TMDB rating" }),
			{ value: "15h", icon: "hourglass", label: "Time to beat" },
			{ value: "Released", icon: "clapperboard", label: "Production status" },
		]);
		expect(
			videoGameSummaryFacts(
				videoGameSummary({ timeToBeat: null, providerRating: null, productionStatus: null }),
			),
		).toEqual([]);
		expect(videoGameSummaryFacts(videoGameSummary({ timeToBeat: { hastily: 600 } }))).toEqual([
			expect.objectContaining({ label: "TMDB rating" }),
			expect.objectContaining({ label: "Production status" }),
		]);
	});

	it("titles the credits for games and names the group a collection", () => {
		const { unmount, container } = renderBody();

		expect(container.textContent).toContain("Video Game");
		expect(container.textContent).toContain("Cast & credits");
		expect(container.textContent).toContain("Developers & publishers");
		expect(container.textContent).toContain("View collection");
		unmount();
	});

	it("renders every pace and platform release the providers recorded", () => {
		const { unmount, container } = renderBody();

		expect(container.textContent).toContain("How long to beat");
		expect(container.textContent).toContain("Hastily");
		expect(container.textContent).toContain("10h");
		expect(container.textContent).toContain("25h");
		expect(container.textContent).toContain("Platforms");
		expect(container.textContent).toContain("PlayStation 5");
		expect(container.textContent).toContain("Worldwide");
		expect(container.textContent).toContain("2022");
		expect(container.textContent).toContain("PC");
		unmount();
	});

	it("drops both game sections when neither property was populated", () => {
		const { unmount, container } = renderBody({ timeToBeat: null, platformReleases: null });

		expect(container.textContent).not.toContain("How long to beat");
		expect(container.textContent).not.toContain("Platforms");
		unmount();
	});

	it("reads the time to beat on rows and hints how much was played", () => {
		const data = presentationData(videoGameFields.timeToBeat.normally);

		expect(videoGamePresentationFacts(data)).toEqual(["15h"]);
		expect(videoGamePresentationFacts(presentationData(null))).toEqual([]);
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<videoGameSchema.CardContent compact data={data} entityId="media-1" />,
		);
		expect(container.textContent).toContain("15h");
		expect(container.textContent).toContain("42% played");
		unmount();
	});
});
