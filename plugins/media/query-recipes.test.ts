import { describe, expect, it } from "vitest";

import {
	buildCollectionMediaSuggestionsQueryDocument,
	buildDefaultMediaSavedViewQueryDocument,
	buildShowDetailQueryDocument,
} from "./query-recipes";

describe("media query recipes", () => {
	it("builds show details with caller-owned nested limits", () => {
		const doc = buildShowDetailQueryDocument({
			seasonLimit: 4,
			episodeLimit: 12,
			entityId: "show-id",
		});
		const seasons = doc.output.include?.[0];
		const episodes = seasons && "include" in seasons ? seasons.include[0] : undefined;

		expect(doc.source.where).toMatchObject({ operator: "eq", type: "comparison" });
		expect(seasons).toMatchObject({ key: "seasons", limit: 4 });
		expect(episodes).toMatchObject({ key: "episodes", limit: 12 });
	});

	it("uses identity fields for media recommendation groups", () => {
		const doc = buildCollectionMediaSuggestionsQueryDocument({
			entitySchemaSlug: "book",
			collectionId: "collection-id",
		});

		expect(doc.output.groupBy?.map((field) => field.key)).toEqual(["id", "name", "schemaSlug"]);
		expect(doc.output.measures[0]).toMatchObject({ key: "recommendingSourceCount" });
	});

	it("adds the in-library relationship to media saved views", () => {
		const document = buildDefaultMediaSavedViewQueryDocument({ schemas: ["book"] });

		expect(document.source.where).toMatchObject({
			type: "exists",
			source: { via: { schema: "in-library" } },
		});
	});
});
