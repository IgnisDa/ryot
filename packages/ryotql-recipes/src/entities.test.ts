import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import { entityWatchRecipe } from "./entities";
import { rowsResponse } from "./test-utils";

const pageInfo = { limit: 2, hasMore: false, nextCursor: null };
const item = {
	userId: null,
	id: "entity-1",
	externalId: "external-1",
	entitySchemaSlug: "unit",
	providerId: "provider-1",
	properties: { pages: 320 },
	entitySchemaPluginId: "plugin-fixture",
	populatedAt: "2026-10-23T10:15:30.123Z",
	populationStatus: { state: "succeeded", availability: "complete" },
	translationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "queued", availability: "missing" },
};
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
			"populationStatus",
			"externalId",
			"entitySchemaSlug",
			"translationStatus",
			"populatedAt",
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
});
