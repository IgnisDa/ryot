import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import { entityInterestRecipe, entityRouteProvenanceRecipe } from "./entities";
import { rowsResponse } from "./test-utils";

const pageInfo = { limit: 2, hasMore: false, nextCursor: null };
const item = {
	id: "entity-1",
	externalId: "external-1",
	entitySchemaSlug: "book",
	providerId: "provider-1",
	populationStatus: "ready",
	properties: { pages: 320 },
	translationStatus: "ready",
};
const provenanceResponse = (items: readonly unknown[]) => rowsResponse("entity", items, pageInfo);
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
			"entitySchemaSlug",
			"populationStatus",
			"translationStatus",
			"providerId",
		]);
		expect(query.where).toMatchObject({ values: [{ value: "entity-1" }, { value: "entity-2" }] });
		expect(Result.getOrThrow(recipe.decode(responseWithItems([item])))).toEqual([item]);
	});

	it("decodes nullable fields", () => {
		const recipe = entityInterestRecipe({ entityIds: ["entity-1"] });
		expect(
			Result.getOrThrow(
				recipe.decode(responseWithItems([{ ...item, externalId: null, providerId: null }])),
			),
		).toEqual([{ ...item, externalId: null, providerId: null }]);
	});

	it("rejects malformed fields and non-rows results", () => {
		const recipe = entityInterestRecipe({ entityIds: ["entity-1"] });
		expect(
			Result.isFailure(recipe.decode(responseWithItems([{ ...item, properties: undefined }]))),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode(responseWithItems([{ ...item, populationStatus: "bad" }]))),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode({ data: { entities: { items: [], type: "aggregate" } } })),
		).toBe(true);
	});

	it("prepares an exact-ID query with only route provenance fields", () => {
		const recipe = entityRouteProvenanceRecipe({ entityId: "entity-1" });
		const query = recipe.document.queries.entity;
		assert(query);
		assert(query.output.type === "rows");

		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(
			query.output.fields.map((selection) => ("key" in selection ? selection.key : null)),
		).toEqual(["entitySchemaSlug", "entitySchemaPluginId"]);
		expect(query.where).toEqual({
			operator: "eq",
			type: "comparison",
			right: { type: "literal", value: "entity-1" },
			left: { field: "id", type: "column", tableAlias: "entity" },
		});
	});

	it("decodes plugin-owned route provenance", () => {
		const recipe = entityRouteProvenanceRecipe({ entityId: "entity-1" });

		expect(
			Result.getOrThrow(
				recipe.decode(
					provenanceResponse([{ entitySchemaSlug: "book", entitySchemaPluginId: "plugin-media" }]),
				),
			),
		).toEqual({ entitySchemaSlug: "book", entitySchemaPluginId: "plugin-media" });
	});

	it("decodes kernel-owned route provenance with a null plugin ID", () => {
		const recipe = entityRouteProvenanceRecipe({ entityId: "entity-1" });

		expect(
			Result.getOrThrow(
				recipe.decode(
					provenanceResponse([{ entitySchemaSlug: "book", entitySchemaPluginId: null }]),
				),
			),
		).toEqual({ entitySchemaSlug: "book", entitySchemaPluginId: null });
	});

	it("maps a missing entity row to null", () => {
		const recipe = entityRouteProvenanceRecipe({ entityId: "missing" });

		expect(Result.getOrThrow(recipe.decode(provenanceResponse([])))).toBeNull();
	});

	it("rejects malformed route provenance", () => {
		const recipe = entityRouteProvenanceRecipe({ entityId: "entity-1" });

		expect(
			Result.isFailure(
				recipe.decode(provenanceResponse([{ entitySchemaSlug: "book", entitySchemaPluginId: 42 }])),
			),
		).toBe(true);
	});
});
