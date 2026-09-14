import { Result } from "@ryot-app/client-sdk/effect";

import { showSummaryRecipe } from "../../../shared/show-recipes";
import { rowsResult } from "../query-result-fixture";

export const showSummaryFixtureRecipe = showSummaryRecipe({
	collectionLimit: 6,
	entityId: "show-1",
});

export const showSummaryRow = {
	owned: null,
	id: "show-1",
	totalSeasons: 1,
	totalEpisodes: 4,
	state: "complete",
	publishYear: 2025,
	isInLibrary: true,
	isMonitored: false,
	schemaSlug: "show",
	name: "Adolescence",
	providerName: "TMDB",
	providerRating: 78.25,
	populationStatus: "ready",
	translationStatus: "none",
	productionStatus: "Ended",
	publishDate: "2025-03-13",
	genres: ["Drama", "Crime"],
	description: "A four-part limited series.",
	collections: {
		pageInfo: { limit: 6, hasMore: false },
		items: [{ name: "Completed", id: "collection-1" }],
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
			data: { show: singleRow(input.show), requested: singleRow(input.requested) },
		}),
	);

export const decodeShowSummary = (overrides: Record<string, unknown> = {}) => {
	const summary = decodeShowSummaryResult({
		requested: [{ schemaSlug: "show" }],
		show: [{ ...showSummaryRow, ...overrides }],
	});
	if (summary.show === null) {
		throw new Error("Expected a decoded show summary");
	}
	return summary.show;
};
