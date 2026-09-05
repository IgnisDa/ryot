import { afterEach, describe, expect, it } from "vitest";

import { showRecipes } from "../../shared/show-recipes";
import { readyQueryResult, rowsResult } from "../../tests/client/query-result-fixture";
import { decodeShowActivity } from "../../tests/client/show/activity-fixture";
import { decodeShowOverview } from "../../tests/client/show/overview-fixture";
import { decodeShowSummary } from "../../tests/client/show/summary-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { mapMediaOverview } from "../media/overview-state";
import { viewerRegion } from "../media/watch-providers";
import {
	showActivityCoverage,
	showPresentationDetail,
	showPresentationFacts,
	showSchema,
	showSummaryFacts,
} from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const presentationRow = {
	id: "show-1",
	storedSeasons: 2,
	name: "Severance",
	publishDate: null,
	publishYear: 2022,
	storedEpisodes: 19,
	schemaSlug: "show",
	watchedEpisodes: 11,
	state: "in_progress",
	inProgressEpisodes: 1,
	populationStatus: "ready",
	translationStatus: "none",
	productionStatus: "Returning Series",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/severance.jpg" }],
};

const presentationData = (overrides: Record<string, unknown> = {}) => {
	const decoded = showRecipes
		.presentationRecipe(["show-1"])
		.decode({
			data: {
				rows: rowsResult([{ ...presentationRow, ...overrides }], {
					limit: 100,
					hasMore: false,
					nextCursor: null,
				}),
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

describe("show schema", () => {
	it("lists the rating, production status and the provider's season and episode counts", () => {
		expect(showSummaryFacts(decodeShowSummary())).toEqual([
			expect.objectContaining({ label: "TMDB rating" }),
			{ value: "Ended", icon: "clapperboard", label: "Production status" },
			{ value: "1", label: "Season", icon: "layers-3" },
			{ value: "4", icon: "tv", label: "Episodes" },
		]);
		expect(
			showSummaryFacts(
				decodeShowSummary({
					totalSeasons: null,
					totalEpisodes: null,
					providerRating: null,
					productionStatus: null,
				}),
			),
		).toEqual([]);
	});

	it("titles the credits as cast and companies and offers where to watch", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<showSchema.ScreenBody
				compact
				episodes={null}
				activity={null}
				safeAreaTop={0}
				settled={undefined}
				refresh={() => undefined}
				refreshOverview={() => undefined}
				overview={mapMediaOverview(readyQueryResult(decodeShowOverview()))}
				state={{
					status: "ready",
					summary: decodeShowSummary({
						watchProviders: [
							{
								link: null,
								country: viewerRegion() ?? "US",
								providers: [{ image: null, name: "Netflix", offers: ["stream"] }],
							},
						],
					}),
				}}
			/>,
		);

		expect(container.textContent).toContain("TV Show");
		expect(container.textContent).toContain("Cast & crew");
		expect(container.textContent).toContain("Production companies");
		expect(container.textContent).toContain("Where to watch");
		unmount();
	});

	it("hints how far a stored show has been watched on cards and rows", () => {
		const data = presentationData();
		const card = mountRyotClient(
			noopAdapter,
			<showSchema.CardContent compact data={data} entityId="show-1" />,
		);

		expect(card.container.querySelector("article > a > *")?.className).toContain("aspect-2/3");
		expect(card.container.textContent).toContain("Returning Series");
		expect(card.container.textContent).toContain("In progress");
		card.unmount();

		expect(showPresentationFacts(data)).toEqual(["Returning Series"]);
		expect(showPresentationDetail(data)).toBe(
			"2 stored seasons · 11 of 19 episodes watched · 1 episode in progress",
		);
		expect(
			showPresentationDetail(
				presentationData({
					storedSeasons: 0,
					storedEpisodes: 0,
					watchedEpisodes: 0,
					inProgressEpisodes: 0,
				}),
			),
		).toBeUndefined();
	});

	it("maps every season to a coverage row and keeps specials out of the headline", () => {
		const coverage = showActivityCoverage(decodeShowActivity());

		expect(coverage.rows).toEqual([
			{ total: 4, watched: 2, percent: 50, key: "season-1", label: "Season 1" },
			{ total: 2, watched: 0, percent: 0, key: "season-0", label: "Specials" },
		]);
		expect(coverage.headline).toEqual({ total: 4, watched: 2 });
		expect(coverage.minutes).toEqual({ total: 116, missing: 0 });
	});

	it("records watches rather than listens", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<showSchema.Activity
				compact
				refresh={() => undefined}
				state={showSchema.mapActivity(readyQueryResult(decodeShowActivity()))}
			/>,
		);

		expect(container.querySelector('[aria-label="Watch record"]')).not.toBeNull();
		expect(container.textContent).toContain("Watches");
		expect(container.textContent).toContain("Coverage");
		expect(container.textContent).toContain("Finished the show");
		unmount();
	});
});
