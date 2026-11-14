import type { RyotQLDocument as ImportedRyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Result } from "@ryot-app/plugin-client-sdk/effect";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import {
	builtinMediaEntitySchemaSlugs,
	creatorGroupTargetSlugs,
} from "../../../shared/media-schema-slugs";
import { rowsResult } from "../query-result-fixture";
import { creatorFixtureRecipes } from "./recipes";

export const creatorOverviewRecipe = bindRecipe(
	creatorFixtureRecipes.overviewRecipe({ reference: { kind: "self" } }),
	{ entityId: "creator-1" },
);
export const creatorMovieCreditRow = {
	order: 1,
	id: "movie-1",
	isGuest: null,
	roles: ["Actor"],
	creditKinds: null,
	departments: null,
	name: "Fight Club",
	isUncredited: null,
	isInMediaLibrary: false,
	character: "The Narrator",
	translationStatus: { state: "idle", availability: "none" },
	images: [{ type: "s3", purpose: "cover", key: "fight-club" }],
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
};

export const creatorAlbumCreditRow = {
	order: null,
	id: "album-1",
	roles: ["Artist"],
	name: "Night Songs",
	isInMediaLibrary: false,
	translationStatus: { state: "idle", availability: "none" },
	images: [{ type: "s3", purpose: "cover", key: "night-songs" }],
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
};

type CreditRows = {
	readonly hasMore?: boolean;
	readonly items: readonly Record<string, unknown>[];
};

export const creatorOverviewData = (input: Readonly<Record<string, CreditRows>> = {}) => ({
	credits: rowsResult(
		[
			Object.fromEntries(
				[...builtinMediaEntitySchemaSlugs, ...creatorGroupTargetSlugs].map((slug) => {
					const rows = input[slug];
					return [
						slug,
						{ items: rows?.items ?? [], pageInfo: { limit: 12, hasMore: rows?.hasMore === true } },
					];
				}),
			),
		],
		{ limit: 1, hasMore: false, nextCursor: null },
	),
});

export const decodeCreatorOverviewOf = <Overview>(
	recipe: { document: ImportedRyotQLDocument; decode: Recipe<Overview, AppSchema>["decode"] },
	input: Readonly<Record<string, CreditRows>> = {},
) => Result.getOrThrow(recipe.decode({ data: creatorOverviewData(input) }));

export const decodeCreatorOverview = (input: Readonly<Record<string, CreditRows>> = {}) =>
	decodeCreatorOverviewOf(creatorOverviewRecipe, input);
