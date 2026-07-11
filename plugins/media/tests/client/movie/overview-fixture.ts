import { Result } from "@ryot-app/client-sdk/effect";

import { movieOverviewRecipe } from "../../../shared/movie-recipes";
import { rowsResult } from "../query-result-fixture";

export const movieOverviewFixtureRecipe = movieOverviewRecipe({
	groupLimit: 20,
	peopleLimit: 12,
	companyLimit: 6,
	entityId: "movie-1",
	recommendationLimit: 12,
});

export const moviePersonRow = {
	order: 1,
	id: "person-1",
	roles: ["Actor"],
	name: "Edward Norton",
	character: "The Narrator",
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "remote", purpose: "profile", url: "https://images.test/edward.jpg" }],
};

export const movieCompanyRow = {
	order: 1,
	id: "company-1",
	name: "Fox 2000 Pictures",
	populationStatus: "ready",
	translationStatus: "none",
	roles: ["Production Company"],
	images: [{ type: "remote", purpose: "logo", url: "https://images.test/fox.png" }],
};

export const movieRecommendationRow = {
	id: "movie-2",
	name: "Se7en",
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/se7en.jpg" }],
};

export const movieGroupMemberRow = {
	id: "movie-3",
	name: "Fight Club 2",
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "s3", purpose: "cover", key: "fc2-cover" }],
};

export const movieGroupRow = {
	id: "group-1",
	populationStatus: "ready",
	translationStatus: "none",
	name: "The Fight Club Collection",
};

type OverviewRows = {
	readonly group?: readonly Record<string, unknown>[];
	readonly people?: readonly Record<string, unknown>[];
	readonly companies?: readonly Record<string, unknown>[];
	readonly groupMovies?: readonly Record<string, unknown>[];
	readonly recommendations?: readonly Record<string, unknown>[];
};

const overviewRows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 12, hasMore: false, nextCursor: null });

const groupRows = (
	group: readonly Record<string, unknown>[],
	movies: readonly Record<string, unknown>[],
) =>
	rowsResult(
		group.map((row) => ({
			...row,
			members: { items: movies, pageInfo: { limit: 20, hasMore: false } },
		})),
		{ limit: 1, hasMore: false, nextCursor: null },
	);

export const decodeMovieOverview = (input: OverviewRows = {}) =>
	Result.getOrThrow(
		movieOverviewFixtureRecipe.decode({
			data: {
				people: overviewRows(input.people ?? [moviePersonRow]),
				companies: overviewRows(input.companies ?? [movieCompanyRow]),
				recommendations: overviewRows(input.recommendations ?? [movieRecommendationRow]),
				group: groupRows(
					input.group ?? [movieGroupRow],
					input.groupMovies ?? [movieGroupMemberRow],
				),
			},
		}),
	);

export const emptyMovieOverview = () =>
	decodeMovieOverview({ group: [], people: [], companies: [], recommendations: [] });

export const groupOnlyMovieOverview = () =>
	decodeMovieOverview({ people: [], companies: [], recommendations: [] });
