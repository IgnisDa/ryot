import { afterEach, describe, expect, it } from "vitest";

import { movieRecipes } from "../../shared/movie-recipes";
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
import { mountRyotClient } from "../../tests/client/test-support";
import { moviePresentationFacts, movieSchema, movieSummaryFacts } from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

const movieFields = { runtime: 169, watchProviders: null };

const movieSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(movieRecipes.summaryRecipe(FLAT_SUMMARY_INPUT), {
		...movieFields,
		...overrides,
	});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("movie schema", () => {
	it("lists the runtime and drops it when unrecorded", () => {
		expect(movieSummaryFacts(movieSummary())).toEqual([
			{ icon: "clock", value: "2h 49m", label: "Runtime" },
		]);
		expect(movieSummaryFacts(movieSummary({ runtime: null }))).toEqual([]);
	});

	it("titles the credits as cast and crew and the group as a collection", () => {
		const { unmount, container } = renderFlatScreenBody(
			movieSchema,
			movieSummary(),
			decodeFlatOverview(movieRecipes.overviewRecipe(FLAT_OVERVIEW_INPUT)),
		);

		expect(container.textContent).toContain("Movie");
		expect(container.textContent).toContain("Cast & crew");
		expect(container.textContent).toContain("Production companies");
		expect(container.textContent).toContain("View collection");
		unmount();
	});

	it("reads the runtime on rows and hints how much was watched", () => {
		const data = decodeFlatPresentation(movieRecipes, { runtime: 169, schemaSlug: "movie" });

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
