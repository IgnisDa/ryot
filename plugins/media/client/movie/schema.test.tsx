import { afterEach, describe, expect, it } from "vitest";

import { movieRecipes } from "../../shared/movie-recipes";
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
import { moviePresentationFacts, movieSchema, movieSummaryFacts } from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const movieFields = { runtime: 169, watchProviders: null };

const movieSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(movieRecipes.summaryRecipe(FLAT_SUMMARY_INPUT), {
		...movieFields,
		...overrides,
	});

const renderBody = () =>
	mountRyotClient(
		noopAdapter,
		<movieSchema.ScreenBody
			compact
			safeAreaTop={0}
			settled={undefined}
			refresh={() => undefined}
			refreshOverview={() => undefined}
			state={{ status: "ready", summary: movieSummary() }}
			overview={mapMediaOverview(
				readyQueryResult(decodeFlatOverview(movieRecipes.overviewRecipe(FLAT_OVERVIEW_INPUT))),
			)}
			activity={
				<movieSchema.Activity
					compact
					refresh={() => undefined}
					state={movieSchema.mapActivity(readyQueryResult(decodeFlatActivity()))}
				/>
			}
		/>,
	);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("movie schema", () => {
	it("lists the rating, runtime and production status and drops the unrecorded ones", () => {
		expect(movieSummaryFacts(movieSummary())).toEqual([
			expect.objectContaining({ label: "TMDB rating" }),
			{ icon: "clock", value: "2h 49m", label: "Runtime" },
			{ value: "Released", icon: "clapperboard", label: "Production status" },
		]);
		expect(
			movieSummaryFacts(
				movieSummary({ runtime: null, providerRating: null, productionStatus: null }),
			),
		).toEqual([]);
	});

	it("titles the credits as cast and crew and the group as a collection", () => {
		const { unmount, container } = renderBody();

		expect(container.textContent).toContain("Movie");
		expect(container.textContent).toContain("Cast & crew");
		expect(container.textContent).toContain("Production companies");
		expect(container.textContent).toContain("View collection");
		unmount();
	});

	it("reads the runtime on rows and hints how much was watched", () => {
		const decoded = movieRecipes
			.presentationRecipe(["media-1"])
			.decode({
				data: {
					rows: rowsResult(
						[
							{
								runtime: 169,
								images: null,
								id: "media-1",
								publishDate: null,
								publishYear: 1999,
								name: "Fight Club",
								schemaSlug: "movie",
								progressPercent: 42,
								state: "in_progress",
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
		const data = { ...decoded.success[0], batchAssets: [] };

		expect(moviePresentationFacts(data)).toEqual(["2h 49m"]);
		expect(moviePresentationFacts({ ...data, runtime: null })).toEqual([]);
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<movieSchema.CardContent compact data={data} entityId="media-1" />,
		);
		expect(container.textContent).toContain("42% watched");
		expect(container.querySelector("article > a > *")?.className).toContain("aspect-2/3");
		unmount();
	});
});
