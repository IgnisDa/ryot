import { Result } from "@ryot-app/client-sdk/effect";
import type { PreparedRecipe } from "@ryot-app/client-sdk/ryotql";

import { rowsResult } from "../query-result-fixture";
import { flatFixtureRecipes } from "./recipes";

export const FLAT_OVERVIEW_INPUT = {
	groupLimit: 20,
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "media-1",
	recommendationLimit: 12,
};

export const fixtureOverviewRecipe = flatFixtureRecipes.overviewRecipe(FLAT_OVERVIEW_INPUT);

export const flatPersonRow = {
	order: 1,
	id: "person-1",
	roles: ["Actor"],
	name: "Edward Norton",
	character: "The Narrator",
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "remote", purpose: "profile", url: "https://images.test/edward.jpg" }],
};

export const flatCompanyRow = {
	order: 1,
	id: "company-1",
	name: "Fox 2000 Pictures",
	populationStatus: "ready",
	translationStatus: "none",
	roles: ["Production Company"],
	images: [{ type: "remote", purpose: "logo", url: "https://images.test/fox.png" }],
};

export const flatRecommendationRow = {
	id: "media-2",
	name: "Se7en",
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/se7en.jpg" }],
};

export const flatGroupMemberRow = {
	id: "media-3",
	name: "Fight Club 2",
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "s3", purpose: "cover", key: "fc2-cover" }],
};

export const flatGroupRow = {
	id: "group-1",
	populationStatus: "ready",
	translationStatus: "none",
	name: "The Fight Club Collection",
};

export type FlatOverviewRows = {
	readonly group?: readonly Record<string, unknown>[];
	readonly people?: readonly Record<string, unknown>[];
	readonly companies?: readonly Record<string, unknown>[];
	readonly members?: readonly Record<string, unknown>[];
	readonly recommendations?: readonly Record<string, unknown>[];
	readonly extra?: Record<string, unknown>;
};

export const flatOverviewRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 12, hasMore: false, nextCursor: null });

const groupRows = (
	group: readonly Record<string, unknown>[],
	members: readonly Record<string, unknown>[],
) =>
	rowsResult(
		group.map((row) => ({
			...row,
			members: { items: members, pageInfo: { limit: 20, hasMore: false } },
		})),
		{ limit: 1, hasMore: false, nextCursor: null },
	);

export const flatOverviewData = (input: FlatOverviewRows = {}) => ({
	...input.extra,
	people: flatOverviewRows(input.people ?? [flatPersonRow]),
	companies: flatOverviewRows(input.companies ?? [flatCompanyRow]),
	recommendations: flatOverviewRows(input.recommendations ?? [flatRecommendationRow]),
	group: groupRows(input.group ?? [flatGroupRow], input.members ?? [flatGroupMemberRow]),
});

export const decodeFlatOverview = <Overview>(
	recipe: PreparedRecipe<Overview>,
	input: FlatOverviewRows = {},
) => Result.getOrThrow(recipe.decode({ data: flatOverviewData(input) }));
