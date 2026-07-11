import { Result } from "@ryot-app/client-sdk/effect";

import { movieSummaryRecipe } from "../../../shared/movie-recipes";
import { rowsResult } from "../query-result-fixture";

export const movieSummaryFixtureRecipe = movieSummaryRecipe({
	collectionLimit: 6,
	entityId: "movie-1",
});

export const movieSummaryRow = {
	owned: null,
	runtime: 169,
	id: "movie-1",
	publishYear: 1999,
	state: "complete",
	isInLibrary: true,
	isMonitored: false,
	name: "Fight Club",
	schemaSlug: "movie",
	providerName: "TMDB",
	providerRating: 86.5,
	progressPercent: null,
	populationStatus: "ready",
	translationStatus: "none",
	publishDate: "1999-10-15",
	productionStatus: "Released",
	genres: ["Drama", "Thriller"],
	description: "An insomniac office worker.",
	collections: {
		pageInfo: { limit: 6, hasMore: false },
		items: [{ name: "Completed", id: "collection-1" }],
	},
	images: [
		{ type: "remote", purpose: "backdrop", url: "https://images.test/fc-backdrop.jpg" },
		{ type: "remote", purpose: "cover", url: "https://images.test/fc-cover.jpg" },
	],
	watchProviders: [
		{
			link: null,
			country: "GB",
			providers: [{ image: null, name: "Netflix", offers: ["stream"] }],
		},
		{
			country: "US",
			link: "https://www.themoviedb.org/movie/550/watch?locale=US",
			providers: [
				{ name: "Netflix", offers: ["stream"], image: "https://images.test/netflix.jpg" },
				{ image: null, name: "Apple TV", offers: ["rent", "buy"] },
			],
		},
	],
};

const singleRow = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 1, hasMore: false, nextCursor: null });

export const decodeMovieSummaryResult = (input: {
	readonly movie: readonly Record<string, unknown>[];
	readonly requested: readonly Record<string, unknown>[];
}) =>
	Result.getOrThrow(
		movieSummaryFixtureRecipe.decode({
			data: { movie: singleRow(input.movie), requested: singleRow(input.requested) },
		}),
	);

export const decodeMovieSummary = (overrides: Record<string, unknown> = {}) => {
	const summary = decodeMovieSummaryResult({
		requested: [{ schemaSlug: "movie" }],
		movie: [{ ...movieSummaryRow, ...overrides }],
	});
	if (summary.movie === null) {
		throw new Error("Expected a decoded movie summary");
	}
	return summary.movie;
};
