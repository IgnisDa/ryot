import { afterEach, assert, describe, expect, it } from "vitest";

import { musicRecipes } from "../../shared/music-recipes";
import {
	decodeFlatActivity,
	repeatedFlatActivity,
} from "../../tests/client/flat-media/activity-fixture";
import {
	decodeFlatOverview,
	FLAT_OVERVIEW_INPUT,
} from "../../tests/client/flat-media/overview-fixture";
import { decodeFlatPresentation } from "../../tests/client/flat-media/presentation-fixture";
import { renderFlatScreenBody } from "../../tests/client/flat-media/screen-fixture";
import {
	decodeFlatSummary,
	FLAT_SUMMARY_INPUT,
} from "../../tests/client/flat-media/summary-fixture";
import { readyQueryResult } from "../../tests/client/query-result-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { musicPresentationFacts, musicSchema, musicSummaryFacts } from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const musicSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(musicRecipes.summaryRecipe(FLAT_SUMMARY_INPUT), {
		duration: 222,
		byVariousArtists: false,
		...overrides,
	});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("music schema", () => {
	it("lists the track length as m:ss and various artists", () => {
		expect(musicSummaryFacts(musicSummary())).toEqual([
			{ icon: "clock", value: "3:42", label: "Length" },
			{ value: "No", icon: "users", label: "Various artists" },
		]);
		expect(musicSummaryFacts(musicSummary({ duration: null, byVariousArtists: null }))).toEqual([]);
	});

	it("titles the credits as artists and labels and the group as an album", () => {
		const { unmount, container } = renderFlatScreenBody(
			musicSchema,
			musicSummary(),
			decodeFlatOverview(musicRecipes.overviewRecipe(FLAT_OVERVIEW_INPUT)),
		);

		expect(container.textContent).toContain("Music");
		expect(container.textContent).toContain("Artists & credits");
		expect(container.textContent).toContain("Labels");
		expect(container.textContent).toContain("View album");
		expect(container.textContent).not.toContain("Cast & crew");
		expect(container.textContent).not.toContain("Where to watch");
		unmount();
	});

	it("draws square art on cards and rows and hints how much was listened to", () => {
		const data = decodeFlatPresentation(musicRecipes, { duration: 222, schemaSlug: "music" });
		const card = mountRyotClient(
			noopAdapter,
			<musicSchema.CardContent compact data={data} entityId="media-1" />,
		);
		expect(card.container.querySelector("article > a > *")?.className).toContain("aspect-square");
		expect(card.container.textContent).toContain("42% listened");
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
