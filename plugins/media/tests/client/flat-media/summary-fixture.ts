import type { PreparedRecipe } from "@ryot-app/client-sdk/ryotql";

import { decodeMediaSummaryResult } from "../summary-fixture";
import { flatFixtureRecipes } from "./recipes";

export const FLAT_SUMMARY_INPUT = { collectionLimit: 6, entityId: "media-1" };

export const fixtureSummaryRecipe = flatFixtureRecipes.summaryRecipe(FLAT_SUMMARY_INPUT);

export const flatSummaryRow = {
	owned: null,
	id: "media-1",
	publishYear: 1999,
	state: "complete",
	isMonitored: false,
	name: "Fight Club",
	providerName: "TMDB",
	providerRating: 86.5,
	schemaSlug: "fixture",
	progressPercent: null,
	isInMediaLibrary: true,
	populationStatus: "ready",
	translationStatus: "none",
	publishDate: "1999-10-15",
	productionStatus: "Released",
	genres: ["Drama", "Thriller"],
	description: "An insomniac office worker.",
	collections: {
		pageInfo: { limit: 6, hasMore: false },
		items: [{ name: "Completed", id: "collection-1" }],
	},
	images: [
		{ type: "remote", purpose: "backdrop", url: "https://images.test/fc-backdrop.jpg" },
		{ type: "remote", purpose: "cover", url: "https://images.test/fc-cover.jpg" },
	],
};

export const decodeFlatSummary = <Summary>(
	recipe: PreparedRecipe<{ readonly summary: Summary | null }>,
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
