import { showOverviewRecipe } from "@ryot/media-plugin/query-recipes";
import { rowsResult } from "@ryot/ryotql-recipes/test-utils";
import { Result } from "effect";

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
	roles: ["Actor", "Guest Star"],
	images: [{ type: "remote", url: "https://images.test/owen.jpg", purpose: "profile" }],
};

export const showCompanyRow = {
	order: 1,
	id: "company-1",
	name: "Warp Films",
	roles: ["Production Company"],
	images: [{ type: "remote", url: "https://images.test/warp.png", purpose: "logo" }],
};

export const showRecommendationRow = {
	id: "show-2",
	name: "Bad Girls",
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
	const decoded = showOverviewFixtureRecipe.decode({
		data: {
			people: overviewRows(input.people ?? [showPersonRow]),
			companies: overviewRows(input.companies ?? [showCompanyRow]),
			recommendations: overviewRows(input.recommendations ?? [showRecommendationRow]),
		},
	});
	if (Result.isFailure(decoded)) {
		throw new Error("Expected a decoded show overview result");
	}
	return decoded.success;
};

export const emptyShowOverview = () =>
	decodeShowOverview({ people: [], companies: [], recommendations: [] });
