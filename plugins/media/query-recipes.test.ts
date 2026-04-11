import { describe, expect, it } from "vitest";

import {
	buildCollectionMediaSuggestionsQueryDocument,
	buildShowDetailQueryDocument,
	buildTrendingMediaQueryDocument,
} from "./query-recipes";

describe("media query recipes", () => {
	it("builds show details with caller-owned nested limits", () => {
		const doc = buildShowDetailQueryDocument({
			seasonLimit: 4,
			episodeLimit: 12,
			entityId: "show-id",
		});
		const seasons = doc.queries.show.output.include?.[0];
		const episodes = seasons && "include" in seasons ? seasons.include?.[0] : undefined;

		expect(doc.queries.show.where).toMatchObject({ type: "and" });
		expect(seasons).toMatchObject({ key: "seasons", limit: 4 });
		expect(episodes).toMatchObject({ key: "episodes", limit: 12 });
	});

	it("uses identity fields for media recommendation groups", () => {
		const doc = buildCollectionMediaSuggestionsQueryDocument({
			entitySchemaSlug: "book",
			collectionId: "collection-id",
		});

		expect(doc.queries.recommendations.output.groupBy?.map((field) => field.key)).toEqual([
			"id",
			"name",
			"schemaSlug",
		]);
		expect(doc.queries.recommendations.output.measures[0]).toMatchObject({
			key: "recommendingSourceCount",
		});
	});

	it("keeps trending timestamps as dates in fields and predicates", () => {
		const document = buildTrendingMediaQueryDocument({
			entitySchemaSlug: "book",
			fetchedAt: "2024-01-02T00:00:00.000Z",
		});
		const fetchedAt = document.queries.trending.output.fields.find(
			(field) => field.key === "fetchedAt",
		);

		expect(fetchedAt).toMatchObject({ expr: { target: "date", type: "cast" } });
		const where = document.queries.trending.where;
		if (where?.type !== "and") {
			throw new Error("Expected trending predicates");
		}
		const fetchedAtPredicate = where.predicates.at(-1);
		expect(fetchedAtPredicate).toMatchObject({
			left: { target: "date", type: "cast" },
			right: { target: "date", type: "cast" },
		});
	});
});
