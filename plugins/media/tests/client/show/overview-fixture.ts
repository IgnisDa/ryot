import { Result } from "@ryot-app/client-sdk/effect";

import { showOverviewRecipe } from "../../../shared/show-recipes";
import { rowsResult } from "./query-result-fixture";

export const showOverviewFixtureRecipe = showOverviewRecipe({
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
	images: [{ type: "remote", url: "https://images.test/owen.jpg", purpose: "profile" }],
};

export const showCompanyRow = {
	order: 1,
	id: "company-1",
	name: "Warp Films",
	populationStatus: "ready",
	translationStatus: "none",
	roles: ["Production Company"],
	images: [{ type: "remote", url: "https://images.test/warp.png", purpose: "logo" }],
};

export const showRecommendationRow = {
	id: "show-2",
	name: "Bad Girls",
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "remote", url: "https://images.test/bad-girls.jpg", purpose: "cover" }],
};

type OverviewRows = {
	readonly people?: readonly Record<string, unknown>[];
	readonly companies?: readonly Record<string, unknown>[];
	readonly recommendations?: readonly Record<string, unknown>[];
};

const overviewRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { hasMore: false, limit: 12, nextCursor: null });

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
