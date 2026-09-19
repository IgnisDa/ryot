import { Effect, Result } from "@ryot-app/client-sdk/effect";
import { afterEach, describe, expect, it } from "vitest";

import { videoGameRecipes } from "../../shared/video-game-recipes";
import {
	FLAT_OVERVIEW_INPUT,
	flatOverviewData,
	flatOverviewRows,
	flatRecommendationRow,
} from "../../tests/client/flat-media/overview-fixture";
import { decodeFlatPresentation } from "../../tests/client/flat-media/presentation-fixture";
import {
	decodeFlatSummary,
	FLAT_SUMMARY_INPUT,
} from "../../tests/client/flat-media/summary-fixture";
import { renderMediaScreenBody } from "../../tests/client/screen-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import {
	videoGameOverviewRails,
	videoGamePresentationFacts,
	videoGameSchema,
	videoGameSummaryFacts,
} from "./schema";

const noopAdapter = { query: () => Effect.succeed({}) };

const relatedRow = (id: string, name: string, kind: string | null) => ({
	...flatRecommendationRow,
	id,
	name,
	kind,
});

const videoGameOverview = (
	related: {
		readonly originals?: readonly Record<string, unknown>[];
		readonly derivatives?: readonly Record<string, unknown>[];
	} = {},
) =>
	Result.getOrThrow(
		videoGameRecipes
			.overviewRecipe(FLAT_OVERVIEW_INPUT)
			.decode({
				data: {
					...flatOverviewData(),
					originals: flatOverviewRows(related.originals ?? []),
					derivatives: flatOverviewRows(related.derivatives ?? []),
				},
			}),
	);

const videoGameFields = {
	gameType: "Port",
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

const renderBody = (
	overrides: Record<string, unknown> = {},
	overview: ReturnType<typeof videoGameOverview> = videoGameOverview(),
) => renderMediaScreenBody(videoGameSchema, videoGameSummary(overrides), overview);

const presentationData = (timeToBeatNormally: number | null) =>
	decodeFlatPresentation(videoGameRecipes, { timeToBeatNormally, schemaSlug: "video-game" });

afterEach(() => {
	document.body.innerHTML = "";
});

describe("video game schema", () => {
	it("lists the game type and time to beat, dropping each when unrecorded", () => {
		expect(videoGameSummaryFacts(videoGameSummary())).toEqual([
			{ value: "Port", label: "Type", icon: "gamepad-2" },
			{ value: "15h", icon: "hourglass", label: "Time to beat" },
		]);
		expect(videoGameSummaryFacts(videoGameSummary({ timeToBeat: null }))).toEqual([
			{ value: "Port", label: "Type", icon: "gamepad-2" },
		]);
		expect(
			videoGameSummaryFacts(videoGameSummary({ gameType: null, timeToBeat: { hastily: 600 } })),
		).toEqual([]);
	});

	it("titles one rail per original, then groups derivatives by kind in priority order", () => {
		const rails = videoGameOverviewRails(
			videoGameOverview({
				originals: [relatedRow("g-0", "Skyrim", "Port")],
				derivatives: [
					relatedRow("g-1", "Beyond Skyrim", "Mod"),
					relatedRow("g-2", "Dawnguard", "DLC"),
					relatedRow("g-3", "Skyrim PS3", "Port"),
					relatedRow("g-4", "Skyrim Anniversary", "Remaster"),
					relatedRow("g-5", "Zed", "Zeta"),
					relatedRow("g-6", "Loose", null),
					relatedRow("g-7", "Skyrim Switch", "Port"),
				],
			}),
		);

		expect(rails.map((rail) => [rail.title, rail.items.map((item) => item.id)])).toEqual([
			["Port of Skyrim", ["g-0"]],
			["Ports", ["g-3", "g-7"]],
			["Remasters", ["g-4"]],
			["DLC", ["g-2"]],
			["Mods", ["g-1"]],
			["Related", ["g-6"]],
			["Zeta", ["g-5"]],
		]);
	});

	it("renders the related rails on the overview and drops them when there are none", () => {
		const related = renderBody(
			{},
			videoGameOverview({
				originals: [relatedRow("g-0", "Skyrim", "Port")],
				derivatives: [relatedRow("g-3", "Skyrim PS3", "Remake")],
			}),
		);
		expect(related.container.textContent).toContain("Port of Skyrim");
		expect(related.container.textContent).toContain("Remakes");
		expect(related.container.querySelector('a[href="/e/g-3"]')).not.toBeNull();
		related.unmount();

		const bare = renderBody();
		expect(bare.container.textContent).not.toContain("Remakes");
		expect(bare.container.textContent).not.toContain("Port of Skyrim");
		bare.unmount();
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
