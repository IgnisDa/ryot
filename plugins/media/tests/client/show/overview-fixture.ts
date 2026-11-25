import { Result } from "@ryot-app/plugin-client-sdk/effect";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import { showRecipes } from "../../../shared/show-recipes";
import { rowsResult } from "../query-result-fixture";

export const showOverviewFixtureRecipe = bindRecipe(
	showRecipes.overviewRecipe({ reference: { kind: "self" } }),
	{ entityId: "show-1" },
);
export const showPersonRow = {
	order: 1,
	isGuest: null,
	id: "person-1",
	roleCodes: null,
	creditKinds: null,
	departments: null,
	character: "Jamie",
	isUncredited: null,
	name: "Owen Cooper",
	isInMediaLibrary: false,
	roles: ["Actor", "Guest Star"],
	translationStatus: { state: "idle", availability: "none" },
	image: { type: "remote", url: "https://images.test/owen.jpg" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
};

export const showCompanyRow = {
	order: 1,
	roles: [],
	id: "company-1",
	name: "Warp Films",
	isInMediaLibrary: false,
	roleCodes: ["production_company"],
	translationStatus: { state: "idle", availability: "none" },
	image: { type: "remote", url: "https://images.test/warp.png" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
};

export const showRecommendationRow = {
	id: "show-2",
	name: "Bad Girls",
	isInMediaLibrary: false,
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	image: { type: "remote", url: "https://images.test/bad-girls.jpg" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
};

type OverviewRows = {
	readonly people?: readonly Record<string, unknown>[];
	readonly companies?: readonly Record<string, unknown>[];
	readonly recommendations?: readonly Record<string, unknown>[];
};

const overviewRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 12, hasMore: false, nextCursor: null });

export const decodeShowOverview = (input: OverviewRows = {}) => {
	return Result.getOrThrow(
		showOverviewFixtureRecipe.decode({
			data: {
				people: overviewRows(input.people ?? [showPersonRow]),
				companies: overviewRows(input.companies ?? [showCompanyRow]),
				recommendations: overviewRows(input.recommendations ?? [showRecommendationRow]),
			},
		}),
	);
};

export const emptyShowOverview = () =>
	decodeShowOverview({ people: [], companies: [], recommendations: [] });
