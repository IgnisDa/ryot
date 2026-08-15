import type { PreparedRecipe } from "@ryot-app/client-sdk/ryotql";

import { decodeMediaSummaryResult } from "../summary-fixture";
import { creatorFixtureRecipes } from "./recipes";

export const CREATOR_SUMMARY_INPUT = { collectionLimit: 6, entityId: "creator-1" };

export const creatorSummaryRecipe = creatorFixtureRecipes.summaryRecipe(CREATOR_SUMMARY_INPUT);

export const creatorSummaryRow = {
	id: "creator-1",
	isInLibrary: true,
	isMonitored: false,
	providerName: "TMDB",
	name: "Edward Norton",
	schemaSlug: "creator",
	populationStatus: "ready",
	translationStatus: "none",
	description: "An American actor.",
	alternateNames: ["Ed Norton", "Eddie", "E. Norton", "Edward H. Norton", "Norton"],
	collections: {
		pageInfo: { limit: 6, hasMore: false },
		items: [{ name: "Favourites", id: "collection-1" }],
	},
	images: [
		{ type: "remote", purpose: "profile", url: "https://images.test/edward.jpg" },
		{ type: "remote", purpose: "logo", url: "https://images.test/logo.png" },
	],
};

export const decodeCreatorSummaryResult = (
	summary: readonly Record<string, unknown>[] = [creatorSummaryRow],
	requested: readonly Record<string, unknown>[] = [{ schemaSlug: "creator" }],
) => decodeMediaSummaryResult(creatorSummaryRecipe, { summary, requested });

export const decodeCreatorSummary = <Summary>(
	recipe: PreparedRecipe<{ readonly summary: Summary | null }>,
	fields: Record<string, unknown>,
) => {
	const { summary } = decodeMediaSummaryResult(recipe, {
		requested: [{ schemaSlug: "creator" }],
		summary: [{ ...creatorSummaryRow, ...fields }],
	});
	if (summary === null) {
		throw new Error("Expected a decoded summary");
	}
	return summary;
};
