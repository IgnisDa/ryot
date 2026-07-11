import { afterEach, assert, describe, expect, it } from "vitest";

import {
	musicOverviewRecipe,
	musicPresentationRecipe,
	musicSummaryRecipe,
} from "../../shared/music-recipes";
import {
	decodeFlatActivity,
	repeatedFlatActivity,
} from "../../tests/client/flat-media/activity-fixture";
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
import { musicPresentationFacts, musicSchema, musicSummaryFacts } from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const musicSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(musicSummaryRecipe(FLAT_SUMMARY_INPUT), {
		duration: 222,
		byVariousArtists: false,
		...overrides,
	});

const presentationData = () => {
	const decoded = musicPresentationRecipe(["media-1"]).decode({
		data: {
			rows: rowsResult(
				[
					{
						images: null,
						duration: 222,
						id: "media-1",
						publishDate: null,
						publishYear: 1997,
						schemaSlug: "music",
						progressPercent: 42,
						state: "in_progress",
						name: "Paranoid Android",
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

describe("music schema", () => {
	it("lists the track length as m:ss, various artists and production status", () => {
		expect(musicSummaryFacts(musicSummary())).toEqual([
			expect.objectContaining({ label: "TMDB rating" }),
			{ icon: "clock", value: "3:42", label: "Length" },
			{ value: "No", icon: "users", label: "Various artists" },
			{ value: "Released", icon: "clapperboard", label: "Production status" },
		]);
		expect(
			musicSummaryFacts(
				musicSummary({
					duration: null,
					providerRating: null,
					byVariousArtists: null,
					productionStatus: null,
				}),
			),
		).toEqual([]);
	});

	it("titles the credits as artists and labels and the group as an album", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<musicSchema.ScreenBody
				compact
				activity={null}
				safeAreaTop={0}
				settled={undefined}
				refresh={() => undefined}
				refreshOverview={() => undefined}
				state={{ status: "ready", summary: musicSummary() }}
				overview={mapMediaOverview(
					readyQueryResult(decodeFlatOverview(musicOverviewRecipe(FLAT_OVERVIEW_INPUT))),
				)}
			/>,
		);

		expect(container.textContent).toContain("Music");
		expect(container.textContent).toContain("Artists & credits");
		expect(container.textContent).toContain("Labels");
		expect(container.textContent).toContain("View album");
		expect(container.textContent).not.toContain("Cast & crew");
		expect(container.textContent).not.toContain("Where to watch");
		unmount();
	});

	it("draws square art on cards and rows and hints how much was played", () => {
		const data = presentationData();
		const card = mountRyotClient(
			noopAdapter,
			<musicSchema.CardContent compact data={data} entityId="media-1" />,
		);
		expect(card.container.querySelector("article > a > *")?.className).toContain("aspect-square");
		expect(card.container.textContent).toContain("42% played");
		card.unmount();

		const row = mountRyotClient(
			noopAdapter,
			<musicSchema.RowContent compact data={data} entityId="media-1" />,
		);
		expect(row.container.querySelector("article > a > *")?.className).toContain("h-20 w-20");
		row.unmount();

		expect(musicPresentationFacts(data)).toEqual(["3:42"]);
		expect(musicPresentationFacts({ ...data, duration: null })).toEqual([]);
	});

	it("records listens rather than watches", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<musicSchema.Activity
				compact
				refresh={() => undefined}
				state={musicSchema.mapActivity(readyQueryResult(repeatedFlatActivity()))}
			/>,
		);

		expect(container.querySelector('[aria-label="Listen record"]')).not.toBeNull();
		expect(container.textContent).toContain("Listens");
		expect(container.textContent).toContain("Listen 2 ·");
		expect(container.textContent).toContain("Finished the track");
		unmount();

		const view = musicSchema.activityView(decodeFlatActivity());
		assert(view?.timeline.layout === "flat");
		expect(view.timeline.rows.map(musicSchema.activityRowLabel)).toContain("42% through the track");
	});
});
