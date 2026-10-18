import { Result } from "@ryot-app/plugin-client-sdk/effect";

import { showRecipes } from "../../../shared/show-recipes";
import { rowsResult } from "../query-result-fixture";

export const showSummaryFixtureRecipe = showRecipes.summaryRecipe({
	collectionLimit: 6,
	entityId: "show-1",
	reference: { kind: "self" },
});

export const showSummaryRow = {
	owned: null,
	id: "show-1",
	ownedOn: null,
	totalSeasons: 1,
	totalEpisodes: 4,
	airedEpisodes: 4,
	state: "complete",
	publishYear: 2025,
	watchedEpisodes: 1,
	isMonitored: false,
	schemaSlug: "show",
	upcomingEpisodes: 0,
	name: "Adolescence",
	providerName: "TMDB",
	inProgressEpisodes: 0,
	providerRating: 78.25,
	isInMediaLibrary: true,
	productionStatus: "Ended",
	publishDate: "2025-03-13",
	description: "A four-part limited series.",
	translationStatus: { state: "idle", availability: "none" },
	nextUp: { items: [], pageInfo: { limit: 1, hasMore: false } },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
	collections: {
		pageInfo: { limit: 6, hasMore: false },
		items: [{ name: "Completed", id: "collection-1" }],
	},
	genres: {
		pageInfo: { limit: 100, hasMore: false },
		items: [
			{ name: "Crime", id: "genre-crime" },
			{ name: "Drama", id: "genre-drama" },
		],
	},
	images: [
		{ type: "remote", purpose: "backdrop", url: "https://images.test/backdrop.jpg" },
		{ type: "remote", purpose: "cover", url: "https://images.test/cover.jpg" },
	],
	watchProviders: [
		{
			link: null,
			country: "GB",
			providers: [{ image: null, name: "Netflix", offers: ["stream"] }],
		},
		{
			country: "US",
			link: "https://www.themoviedb.org/tv/1/watch?locale=US",
			providers: [
				{ name: "Netflix", offers: ["stream"], image: "https://images.test/netflix.jpg" },
				{ image: null, name: "Apple TV", offers: ["rent", "buy"] },
			],
		},
	],
};

const singleRow = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

export const decodeShowSummaryResult = (input: {
	readonly show: readonly Record<string, unknown>[];
	readonly requested: readonly Record<string, unknown>[];
}) =>
	Result.getOrThrow(
		showSummaryFixtureRecipe.decode({
			data: { summary: singleRow(input.show), requested: singleRow(input.requested) },
		}),
	);

export const decodeShowSummary = (overrides: Record<string, unknown> = {}) => {
	const summary = decodeShowSummaryResult({
		requested: [{ schemaSlug: "show" }],
		show: [{ ...showSummaryRow, ...overrides }],
	});
	if (summary.summary === null) {
		throw new Error("Expected a decoded show summary");
	}
	return summary.summary;
};
