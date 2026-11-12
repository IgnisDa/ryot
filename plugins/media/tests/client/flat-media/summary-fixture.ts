import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import { decodeMediaSummaryResult } from "../summary-fixture";
import { flatFixtureRecipes } from "./recipes";

export const FLAT_SUMMARY_INPUT = { entityId: "media-1", reference: { kind: "self" } } as const;
export const fixtureSummaryRecipe = bindRecipe(
	flatFixtureRecipes.summaryRecipe({ reference: FLAT_SUMMARY_INPUT.reference }),
	{ entityId: FLAT_SUMMARY_INPUT.entityId },
);
export const flatSummaryRow = {
	owned: null,
	ownedOn: null,
	id: "media-1",
	isCustom: false,
	publishYear: 1999,
	state: "complete",
	isMonitored: false,
	name: "Fight Club",
	providerName: "TMDB",
	providerRating: 86.5,
	schemaSlug: "fixture",
	progressPercent: null,
	isInMediaLibrary: true,
	providerCheckedAt: null,
	publishDate: "1999-10-15",
	productionStatus: "Released",
	description: "An insomniac office worker.",
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
	collections: {
		pageInfo: { limit: 6, hasMore: false },
		items: [{ name: "Completed", id: "collection-1" }],
	},
	genres: {
		pageInfo: { limit: 100, hasMore: false },
		items: [
			{ name: "Drama", id: "genre-drama" },
			{ name: "Thriller", id: "genre-thriller" },
		],
	},
	images: [
		{ type: "remote", purpose: "backdrop", url: "https://images.test/fc-backdrop.jpg" },
		{ type: "remote", purpose: "cover", url: "https://images.test/fc-cover.jpg" },
	],
};

export const decodeFlatSummary = <Summary>(
	recipe: { decode: Recipe<{ readonly summary: null | Summary }, AppSchema>["decode"] },
	overrides: Record<string, unknown> = {},
) => {
	const { summary } = decodeMediaSummaryResult(recipe, {
		requested: [{ schemaSlug: "fixture" }],
		summary: [{ ...flatSummaryRow, ...overrides }],
	});
	if (summary === null) {
		throw new Error("Expected a decoded summary");
	}
	return summary;
};
