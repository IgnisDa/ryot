import { Result } from "@ryot-app/plugin-client-sdk/effect";
import type { PreparedRecipe } from "@ryot-app/plugin-client-sdk/ryotql";

import {
	builtinMediaEntitySchemaSlugs,
	creatorGroupTargetSlugs,
} from "../../../shared/media-schema-slugs";
import { rowsResult } from "../query-result-fixture";
import { creatorFixtureRecipes } from "./recipes";

export const creatorOverviewRecipe = creatorFixtureRecipes.overviewRecipe({
	creditLimit: 12,
	entityId: "creator-1",
	reference: { kind: "self" },
});

export const creatorMovieCreditRow = {
	order: 1,
	id: "movie-1",
	roles: ["Actor"],
	name: "Fight Club",
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
	translationStatus: { state: "idle", availability: "none" },
	images: [{ type: "s3", purpose: "cover", key: "night-songs" }],
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
};

type CreditRows = {
	readonly items: readonly Record<string, unknown>[];
	readonly hasMore?: boolean;
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
	recipe: PreparedRecipe<Overview>,
	input: Readonly<Record<string, CreditRows>> = {},
) => Result.getOrThrow(recipe.decode({ data: creatorOverviewData(input) }));

export const decodeCreatorOverview = (input: Readonly<Record<string, CreditRows>> = {}) =>
	decodeCreatorOverviewOf(creatorOverviewRecipe, input);
