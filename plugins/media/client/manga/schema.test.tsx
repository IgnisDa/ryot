import { Result } from "@ryot-app/client-sdk/effect";
import { afterEach, describe, expect, it } from "vitest";

import { mangaRecipes } from "../../shared/manga-recipes";
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
	mangaPresentationFacts,
	mangaProgressLabel,
	mangaSchema,
	mangaSummaryFacts,
} from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const PROGRESS_EVENT = {
	text: null,
	rating: null,
	mangaVolume: 3,
	timeSpent: null,
	startedOn: null,
	isSpoiler: null,
	mangaChapter: 45,
	completedOn: null,
	progressPercent: 62,
	id: "manga-progress",
	consumedOn: "Kavita",
	eventSchemaSlug: "progress",
	createdAt: "2025-11-03T12:00:05.000Z",
	occurredAt: "2025-11-03T12:00:00.000Z",
};

const mangaSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(mangaRecipes.summaryRecipe(FLAT_SUMMARY_INPUT), {
		volumes: 12,
		chapters: 120,
		...overrides,
	});

const mangaActivity = (events: readonly Record<string, unknown>[] = [PROGRESS_EVENT]) =>
	Result.getOrThrow(
		mangaRecipes
			.activityRecipe({ eventLimit: 60, entityId: "manga-1", collectionEventLimit: 60 })
			.decode({
				data: {
					events: rowsResult(events, { limit: 60, hasMore: false, nextCursor: null }),
					collectionEvents: rowsResult([], { limit: 60, hasMore: false, nextCursor: null }),
					totals: rowsResult([{ completionCount: 1, consumedAmount: 120, unknownAmountCount: 0 }], {
						limit: 1,
						hasMore: false,
						nextCursor: null,
					}),
				},
			}),
	);

const presentationData = (overrides: Record<string, unknown> = {}) => {
	const decoded = mangaRecipes
		.presentationRecipe(["manga-1"])
		.decode({
			data: {
				rows: rowsResult(
					[
						{
							images: null,
							chapters: 120,
							id: "manga-1",
							publishDate: null,
							publishYear: 1997,
							name: "One Piece",
							schemaSlug: "manga",
							progressPercent: 62,
							state: "in_progress",
							productionStatus: null,
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
		<mangaSchema.ScreenBody
			compact
			activity={null}
			safeAreaTop={0}
			settled={undefined}
			refresh={() => undefined}
			refreshOverview={() => undefined}
			state={{ status: "ready", summary: mangaSummary() }}
			overview={mapMediaOverview(
				readyQueryResult(decodeFlatOverview(mangaRecipes.overviewRecipe(FLAT_OVERVIEW_INPUT))),
			)}
		/>,
	);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("manga schema", () => {
	it("lists the chapter and volume facts and drops the unrecorded ones", () => {
		expect(mangaSummaryFacts(mangaSummary())).toEqual([
			expect.objectContaining({ label: "TMDB rating" }),
			{ value: "120", icon: "book-open", label: "Chapters" },
			{ value: "12", icon: "layers", label: "Volumes" },
			{ value: "Released", icon: "clapperboard", label: "Production status" },
		]);
		expect(
			mangaSummaryFacts(
				mangaSummary({
					volumes: null,
					chapters: null,
					providerRating: null,
					productionStatus: null,
				}),
			),
		).toEqual([]);
	});

	it("names the volume and chapter a progress event recorded, and falls back to the percent", () => {
		expect(mangaProgressLabel("62", { mangaVolume: 3, mangaChapter: 45 })).toBe(
			"Volume 3, Chapter 45",
		);
		expect(mangaProgressLabel("62", { mangaVolume: null, mangaChapter: 45.5 })).toBe(
			"Chapter 45.5",
		);
		expect(mangaProgressLabel("62", { mangaVolume: 3, mangaChapter: null })).toBe("Volume 3");
		expect(mangaProgressLabel("62", { mangaVolume: null, mangaChapter: null })).toBe(
			"62% through the manga",
		);
		expect(mangaProgressLabel(undefined, { mangaVolume: null, mangaChapter: null })).toBe(
			"Part-way through the manga",
		);
	});

	it("labels each imported chapter on its own activity row", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<mangaSchema.Activity
				compact
				refresh={() => undefined}
				state={mangaSchema.mapActivity(
					readyQueryResult(
						mangaActivity([
							PROGRESS_EVENT,
							{
								...PROGRESS_EVENT,
								mangaChapter: 46,
								mangaVolume: null,
								id: "manga-progress-46",
								createdAt: "2025-11-04T12:00:05.000Z",
								occurredAt: "2025-11-04T12:00:00.000Z",
							},
						]),
					),
				)}
			/>,
		);

		expect(container.textContent).toContain("Volume 3, Chapter 45");
		expect(container.textContent).toContain("Chapter 46");
		expect(container.textContent).not.toContain("62% through the manga");
		expect(container.textContent).toContain("Chapters");
		expect(container.textContent).toContain("120");
		unmount();
	});

	it("names the credit rails for a manga and never claims it is part of a series", () => {
		const { unmount, container } = renderBody();

		expect(container.textContent).toContain("Authors & artists");
		expect(container.textContent).toContain("Publishers");
		expect(container.textContent).toContain(flatPersonRow.name);
		expect(container.textContent).not.toContain("Part of");
		unmount();
	});

	it("reads the chapter count on cards and hints how much was read", () => {
		const data = presentationData();

		expect(mangaPresentationFacts(data)).toEqual(["120 chapters"]);
		expect(mangaPresentationFacts({ ...data, chapters: 1 })).toEqual(["1 chapter"]);
		expect(mangaPresentationFacts({ ...data, chapters: null })).toEqual([]);
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<mangaSchema.CardContent compact data={data} entityId="manga-1" />,
		);
		expect(container.textContent).toContain("120 chapters");
		expect(container.textContent).toContain("62% read");
		unmount();
	});
});
