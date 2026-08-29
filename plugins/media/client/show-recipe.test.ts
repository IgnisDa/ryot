import { describe, expect, it } from "vitest";

import { showSummaryRecipe } from "./show-recipe";

const rows = (items: readonly Record<string, unknown>[]) => ({
	type: "rows",
	items,
	pageInfo: { hasMore: false, limit: 1, nextCursor: null },
});

const show = {
	id: "show-1",
	totalSeasons: 2,
	publishYear: 2025,
	totalEpisodes: 12,
	name: "Tracer Show",
	providerName: "TMDB",
	genres: ["Drama", "Mystery"],
	description: "A deterministic show.",
	productionStatus: "Returning Series",
	images: [
		{ type: "remote", url: "https://images.test/cover.jpg", purpose: "cover" },
		{ type: "local", key: "local-cover", purpose: "cover" },
		{ type: "s3", key: "s3-cover", purpose: "cover" },
		{ type: "remote", url: "https://images.test/logo.jpg", purpose: "logo" },
	],
};

const decode = (
	showItems: readonly Record<string, unknown>[],
	requestedItems = [{ entitySchemaSlug: "show" }],
) =>
	showSummaryRecipe({ entityId: "show-1" }).decode({
		data: { show: rows(showItems), requested: rows(requestedItems) },
	});

describe("showSummaryRecipe", () => {
	it("decodes ready show data and all supported image locator variants", () => {
		expect(decode([show])).toMatchObject({
			success: {
				entitySchemaSlug: "show",
				show: {
					id: "show-1",
					name: "Tracer Show",
					images: [
						{ type: "remote", purpose: "cover" },
						{ type: "local", purpose: "cover" },
						{ type: "s3", purpose: "cover" },
						{ type: "remote", purpose: "logo" },
					],
				},
			},
		});
	});

	it("decodes nullable optional fields", () => {
		expect(
			decode([
				{
					...show,
					genres: null,
					images: null,
					publishYear: null,
					description: null,
					providerName: null,
					totalSeasons: null,
					totalEpisodes: null,
					productionStatus: null,
				},
			]),
		).toMatchObject({ success: { show: { genres: null, images: null, description: null } } });
	});

	it("decodes missing and non-Show entity results", () => {
		expect(decode([], [])).toMatchObject({
			success: { show: null, entitySchemaSlug: null },
		});
		expect(decode([], [{ entitySchemaSlug: "movie" }])).toMatchObject({
			success: { show: null, entitySchemaSlug: "movie" },
		});
	});
});
