import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import { entityInterestRecipe } from "./entities";
import { rowsResponse } from "./test-utils";

const pageInfo = { hasMore: false, limit: 2, nextCursor: null };
const item = {
	id: "entity-1",
	externalId: "external-1",
	entitySchemaSlug: "book",
	providerId: "provider-1",
	properties: { pages: 320 },
	translationStatus: "ready",
	populatedAt: "2026-01-01T01:00:00+02:00",
};
const responseWithItems = (items: readonly unknown[]) => rowsResponse("entities", items, pageInfo);

describe("entity recipes", () => {
	it("prepares and decodes the focused entity-interest read", () => {
		const recipe = entityInterestRecipe({ entityIds: ["entity-1", "entity-2"] });
		const query = recipe.document.queries.entities;
		assert(query);
		assert(query.output.type === "rows");

		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(
			query.output.fields.map((selection) => ("key" in selection ? selection.key : null)),
		).toEqual([
			"id",
			"properties",
			"externalId",
			"populatedAt",
			"entitySchemaSlug",
			"providerId",
			"translationStatus",
		]);
		expect(query.where).toMatchObject({ values: [{ value: "entity-1" }, { value: "entity-2" }] });
		expect(Result.getOrThrow(recipe.decode(responseWithItems([item])))).toEqual([
			{ ...item, populatedAt: "2025-12-31T23:00:00.000Z" },
		]);
	});

	it("decodes nullable fields", () => {
		const recipe = entityInterestRecipe({ entityIds: ["entity-1"] });
		expect(
			Result.getOrThrow(
				recipe.decode(
					responseWithItems([{ ...item, externalId: null, populatedAt: null, providerId: null }]),
				),
			),
		).toEqual([{ ...item, externalId: null, populatedAt: null, providerId: null }]);
	});

	it("rejects malformed fields and non-rows results", () => {
		const recipe = entityInterestRecipe({ entityIds: ["entity-1"] });
		expect(
			Result.isFailure(recipe.decode(responseWithItems([{ ...item, properties: undefined }]))),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode(responseWithItems([{ ...item, populatedAt: "bad" }]))),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode({ data: { entities: { items: [], type: "aggregate" } } })),
		).toBe(true);
	});
});
