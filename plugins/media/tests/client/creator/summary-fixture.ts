import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import { decodeMediaSummaryResult } from "../summary-fixture";
import { creatorFixtureRecipes } from "./recipes";

export const CREATOR_SUMMARY_INPUT = {
	entityId: "creator-1",
	reference: { kind: "self" },
} as const;
export const creatorSummaryRecipe = bindRecipe(
	creatorFixtureRecipes.summaryRecipe({ reference: CREATOR_SUMMARY_INPUT.reference }),
	{ entityId: CREATOR_SUMMARY_INPUT.entityId },
);
export const creatorSummaryRow = {
	id: "creator-1",
	isCustom: false,
	isMonitored: false,
	providerName: "TMDB",
	name: "Edward Norton",
	schemaSlug: "creator",
	isInMediaLibrary: true,
	providerCheckedAt: null,
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
	recipe: { decode: Recipe<{ readonly summary: null | Summary }, AppSchema>["decode"] },
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
