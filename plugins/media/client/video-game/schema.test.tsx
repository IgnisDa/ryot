import { afterEach, describe, expect, it } from "vitest";

import { videoGameRecipes } from "../../shared/video-game-recipes";
import {
	decodeFlatOverview,
	FLAT_OVERVIEW_INPUT,
} from "../../tests/client/flat-media/overview-fixture";
import { decodeFlatPresentation } from "../../tests/client/flat-media/presentation-fixture";
import {
	decodeFlatSummary,
	FLAT_SUMMARY_INPUT,
} from "../../tests/client/flat-media/summary-fixture";
import { renderMediaScreenBody } from "../../tests/client/screen-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
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
	decodeFlatSummary(videoGameRecipes.summaryRecipe(FLAT_SUMMARY_INPUT), {
		...videoGameFields,
		...overrides,
	});

const renderBody = (overrides: Record<string, unknown> = {}) =>
	renderMediaScreenBody(
		videoGameSchema,
		videoGameSummary(overrides),
		decodeFlatOverview(videoGameRecipes.overviewRecipe(FLAT_OVERVIEW_INPUT)),
	);

const presentationData = (timeToBeatNormally: number | null) =>
	decodeFlatPresentation(videoGameRecipes, { timeToBeatNormally, schemaSlug: "video-game" });

afterEach(() => {
	document.body.innerHTML = "";
});

describe("video game schema", () => {
	it("lists the time to beat and drops it when unrecorded", () => {
		expect(videoGameSummaryFacts(videoGameSummary())).toEqual([
			{ value: "15h", icon: "hourglass", label: "Time to beat" },
		]);
		expect(videoGameSummaryFacts(videoGameSummary({ timeToBeat: null }))).toEqual([]);
		expect(videoGameSummaryFacts(videoGameSummary({ timeToBeat: { hastily: 600 } }))).toEqual([]);
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
