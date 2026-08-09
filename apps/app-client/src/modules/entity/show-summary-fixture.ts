import { showSummaryRecipe } from "@ryot/media-plugin/query-recipes";
import { rowsResult } from "@ryot/ryotql-recipes/test-utils";
import { Result } from "effect";

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
	productionStatus: "Ended",
	publishDate: "2025-03-13",
	genres: ["Drama", "Crime"],
	description: "A four-part limited series.",
	collections: {
		pageInfo: { hasMore: false, limit: 6 },
		items: [{ id: "collection-1", name: "Completed" }],
	},
	images: [
		{ type: "remote", url: "https://images.test/backdrop.jpg", purpose: "backdrop" },
		{ type: "remote", url: "https://images.test/cover.jpg", purpose: "cover" },
	],
};

const singleRow = (items: readonly unknown[]) =>
	rowsResult(items, { hasMore: false, limit: 1, nextCursor: null });

export const decodeShowSummaryResult = (input: {
	readonly show: readonly Record<string, unknown>[];
	readonly requested: readonly Record<string, unknown>[];
}) => {
	const decoded = showSummaryFixtureRecipe.decode({
		data: { requested: singleRow(input.requested), show: singleRow(input.show) },
	});
	if (Result.isFailure(decoded)) {
		throw new Error("Expected a decoded show summary result");
	}
	return decoded.success;
};

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
