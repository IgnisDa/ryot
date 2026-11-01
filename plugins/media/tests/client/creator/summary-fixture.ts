import type { PreparedRecipe } from "@ryot-app/plugin-client-sdk/ryotql";

import { decodeMediaSummaryResult } from "../summary-fixture";
import { creatorFixtureRecipes } from "./recipes";

export const CREATOR_SUMMARY_INPUT = {
	collectionLimit: 6,
	entityId: "creator-1",
	reference: { kind: "self" },
} satisfies Parameters<typeof creatorFixtureRecipes.summaryRecipe>[0];

export const creatorSummaryRecipe = creatorFixtureRecipes.summaryRecipe(CREATOR_SUMMARY_INPUT);

export const creatorSummaryRow = {
	id: "creator-1",
	isCustom: false,
	isMonitored: false,
	providerName: "TMDB",
	name: "Edward Norton",
	schemaSlug: "creator",
	isInMediaLibrary: true,
	providerCheckedAt: null,
	canRefreshProvider: true,
	description: "An American actor.",
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
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
	recipe: PreparedRecipe<{ readonly summary: null | Summary }>,
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
