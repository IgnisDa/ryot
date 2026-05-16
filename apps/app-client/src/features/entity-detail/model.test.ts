import { describe, expect, it } from "bun:test";

import { toEntityDetail } from "./model";

type EntityInput = Parameters<typeof toEntityDetail>[0];

function makeEntity(properties: Record<string, unknown>): EntityInput {
	return {
		properties,
		id: "entity-1",
		externalId: null,
		name: "Example Title",
		sandboxScriptId: null,
		entitySchemaId: "schema-1",
		createdAt: "2024-01-01T00:00:00.000Z",
		updatedAt: "2024-01-02T00:00:00.000Z",
		populatedAt: "2024-01-03T00:00:00.000Z",
		image: { type: "remote", url: "https://example.com/cover.jpg" },
	};
}

describe("toEntityDetail", () => {
	it("maps direct book fields and creators from the live entity payload", () => {
		const detail = toEntityDetail(
			makeEntity({
				pages: 662,
				isNsfw: true,
				publishYear: 2007,
				providerRating: 9.1,
				isCompilation: false,
				description: "A description.",
				productionStatus: "Published",
				genres: ["Fantasy", "Adventure"],
				sourceUrl: "https://example.com/book",
				unlinkedCreators: [{ name: "Patrick Rothfuss", role: "Author" }],
			}),
			"book",
		);

		if (detail?.entitySchemaSlug !== "book") {
			throw new Error("Expected a book detail");
		}

		expect(detail.pages).toBe(662);
		expect(detail.unlinkedCreators).toEqual([{ name: "Patrick Rothfuss", role: "Author" }]);
		expect(detail.images[0]).toEqual({ type: "remote", url: "https://example.com/cover.jpg" });
	});

	it("maps show seasons and nested episodes from the live entity payload", () => {
		const detail = toEntityDetail(
			makeEntity({
				isNsfw: false,
				genres: ["Drama"],
				publishYear: 2008,
				providerRating: 9.5,
				description: "A show.",
				productionStatus: "Ended",
				showSeasons: [
					{
						id: 1,
						seasonNumber: 1,
						name: "Season 1",
						publishDate: "2008-01-20",
						episodes: [
							{
								id: 11,
								runtime: 58,
								name: "Pilot",
								episodeNumber: 1,
								overview: "The beginning.",
							},
						],
					},
				],
			}),
			"show",
		);

		if (detail?.entitySchemaSlug !== "show") {
			throw new Error("Expected a show detail");
		}

		expect(detail.showSeasons).toEqual([
			{
				id: 1,
				seasonNumber: 1,
				name: "Season 1",
				publishDate: "2008-01-20",
				episodes: [
					{
						id: 11,
						runtime: 58,
						name: "Pilot",
						episodeNumber: 1,
						overview: "The beginning.",
					},
				],
			},
		]);
	});

	it("defaults creator data to an empty list for types without direct creators", () => {
		const detail = toEntityDetail(
			makeEntity({
				isNsfw: false,
				genres: ["Rock"],
				publishYear: 1997,
				providerRating: 9.6,
				description: "An album.",
				productionStatus: "Released",
			}),
			"music",
		);

		if (detail?.entitySchemaSlug !== "music") {
			throw new Error("Expected a music detail");
		}

		expect(detail.unlinkedCreators).toEqual([]);
	});
});
