import { afterEach, describe, expect, it } from "bun:test";

import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import { movieRecipes } from "../../shared/movie-recipes";
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
import { moviePresentationFacts, movieSchema, movieSummaryFacts } from "./schema";

const noopAdapter = { query: () => Effect.succeed({}) };

const movieFields = { runtime: 169, watchProviders: null };

const movieSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(
		bindRecipe(movieRecipes.summaryRecipe({ reference: FLAT_SUMMARY_INPUT.reference }), {
			entityId: FLAT_SUMMARY_INPUT.entityId,
		}),
		{ ...movieFields, ...overrides },
	);
afterEach(() => {
	document.body.innerHTML = "";
});

describe("movie schema", () => {
	it("lists the runtime and drops it when unrecorded", () => {
		expect(movieSummaryFacts(movieSummary())).toEqual([
			{ inline: true, icon: "clock", value: "2h 49m", label: "Runtime" },
		]);
		expect(movieSummaryFacts(movieSummary({ runtime: null }))).toEqual([]);
	});

	it("titles the credits as cast and crew and the group as a collection", () => {
		const { unmount, container } = renderMediaScreenBody(
			movieSchema,
			movieSummary(),
			decodeFlatOverview(
				bindRecipe(movieRecipes.overviewRecipe({ reference: FLAT_OVERVIEW_INPUT.reference }), {
					entityId: FLAT_OVERVIEW_INPUT.entityId,
				}),
			),
		);

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
