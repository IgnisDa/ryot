import { Result } from "@ryot-app/client-sdk/effect";

import { showRecipes } from "../../../shared/show-recipes";
import { rowsResult } from "../query-result-fixture";

export const showOverviewFixtureRecipe = showRecipes.overviewRecipe({
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "show-1",
	recommendationLimit: 12,
});

export const showPersonRow = {
	order: 1,
	id: "person-1",
	character: "Jamie",
	name: "Owen Cooper",
	populationStatus: "ready",
	translationStatus: "none",
	roles: ["Actor", "Guest Star"],
	images: [{ type: "remote", purpose: "profile", url: "https://images.test/owen.jpg" }],
};

export const showCompanyRow = {
	order: 1,
	id: "company-1",
	name: "Warp Films",
	populationStatus: "ready",
	translationStatus: "none",
	roles: ["Production Company"],
	images: [{ type: "remote", purpose: "logo", url: "https://images.test/warp.png" }],
};

export const showRecommendationRow = {
	id: "show-2",
	name: "Bad Girls",
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/bad-girls.jpg" }],
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
