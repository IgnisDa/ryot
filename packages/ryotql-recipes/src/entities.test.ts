import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import { entityRouteProvenanceRecipe, entityWatchRecipe } from "./entities";
import { rowsResponse } from "./test-utils";

const pageInfo = { limit: 2, hasMore: false, nextCursor: null };
const item = {
	userId: null,
	id: "entity-1",
	externalId: "external-1",
	entitySchemaSlug: "unit",
	providerId: "provider-1",
	populationStatus: "ready",
	properties: { pages: 320 },
	translationStatus: "ready",
	relatedPopulationStatus: "pending",
	entitySchemaPluginId: "plugin-fixture",
	populatedAt: "2026-10-23T10:15:30.123Z",
};
const provenanceResponse = (items: readonly unknown[]) => rowsResponse("entity", items, pageInfo);
const responseWithItems = (items: readonly unknown[]) => rowsResponse("entities", items, pageInfo);

describe("entity recipes", () => {
	it("prepares and decodes the focused entity-watches read", () => {
		const recipe = entityWatchRecipe({ entityIds: ["entity-1", "entity-2"] });
		const query = recipe.document.queries.entities;
		assert(query);
		assert(query.output.type === "rows");

		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(
			query.output.fields.map((selection) => ("key" in selection ? selection.key : null)),
		).toEqual([
			"id",
			"properties",
			"userId",
			"externalId",
			"entitySchemaSlug",
			"populationStatus",
			"populatedAt",
			"translationStatus",
			"providerId",
			"relatedPopulationStatus",
			"entitySchemaPluginId",
		]);
		expect(query.where).toMatchObject({ values: [{ value: "entity-1" }, { value: "entity-2" }] });
		expect(Result.getOrThrow(recipe.decode(responseWithItems([item])))).toEqual([item]);
	});

	it("decodes nullable fields", () => {
		const recipe = entityWatchRecipe({ entityIds: ["entity-1"] });
		expect(
			Result.getOrThrow(
				recipe.decode(
					responseWithItems([
						{
							...item,
							userId: null,
							externalId: null,
							providerId: null,
							populatedAt: null,
							entitySchemaPluginId: null,
						},
					]),
				),
			),
		).toEqual([
			{
				...item,
				userId: null,
				externalId: null,
				providerId: null,
				populatedAt: null,
				entitySchemaPluginId: null,
			},
		]);
	});

	it("rejects malformed fields and non-rows results", () => {
		const recipe = entityWatchRecipe({ entityIds: ["entity-1"] });
		expect(
			Result.isFailure(recipe.decode(responseWithItems([{ ...item, properties: undefined }]))),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode(responseWithItems([{ ...item, populationStatus: "bad" }]))),
		).toBe(true);
		expect(
			Result.isFailure(
				recipe.decode(responseWithItems([{ ...item, relatedPopulationStatus: "bad" }])),
			),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode(responseWithItems([{ ...item, populatedAt: "not-a-date" }]))),
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
					provenanceResponse([
						{ entitySchemaSlug: "unit", entitySchemaPluginId: "plugin-fixture" },
					]),
				),
			),
		).toEqual({ entitySchemaSlug: "unit", entitySchemaPluginId: "plugin-fixture" });
	});

	it("decodes kernel-owned route provenance with a null plugin ID", () => {
		const recipe = entityRouteProvenanceRecipe({ entityId: "entity-1" });

		expect(
			Result.getOrThrow(
				recipe.decode(
					provenanceResponse([{ entitySchemaSlug: "unit", entitySchemaPluginId: null }]),
				),
			),
		).toEqual({ entitySchemaSlug: "unit", entitySchemaPluginId: null });
	});

	it("maps a missing entity row to null", () => {
		const recipe = entityRouteProvenanceRecipe({ entityId: "missing" });

		expect(Result.getOrThrow(recipe.decode(provenanceResponse([])))).toBeNull();
	});

	it("rejects malformed route provenance", () => {
		const recipe = entityRouteProvenanceRecipe({ entityId: "entity-1" });

		expect(
			Result.isFailure(
				recipe.decode(provenanceResponse([{ entitySchemaSlug: "unit", entitySchemaPluginId: 42 }])),
			),
		).toBe(true);
	});
});
