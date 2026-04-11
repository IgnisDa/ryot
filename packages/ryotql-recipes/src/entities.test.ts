import { describe, expect, it } from "vitest";

import { buildEntityDetailDocument, buildEntityInterestDocument } from "./entities";

describe("entity recipes", () => {
	it("builds the focused entity detail read", () => {
		const query = buildEntityDetailDocument({ entityId: "entity-1", entitySchemaSlug: "book" })
			.queries["entity"];

		expect(query.output.pagination).toEqual({ page: 1, limit: 1 });
		expect(query.output.fields.map((selection) => selection.key)).toEqual([
			"id",
			"name",
			"createdAt",
			"updatedAt",
			"properties",
			"externalId",
			"populatedAt",
			"entitySchemaSlug",
			"providerId",
			"translationStatus",
		]);
		expect(query.where).toMatchObject({
			type: "and",
			predicates: [
				{ left: { field: "id" }, right: { value: "entity-1" } },
				{ left: { field: "entitySchemaSlug" }, right: { value: "book" } },
			],
		});
		expect(query.output.orderBy).toEqual([
			{ direction: "asc", expr: { type: "column", tableAlias: "entity", field: "id" } },
		]);
	});

	it("builds the focused entity interest read", () => {
		const query = buildEntityInterestDocument({ entityIds: ["entity-1", "entity-2"] }).queries[
			"entities"
		];

		expect(query.output.pagination).toEqual({ page: 1, limit: 2 });
		expect(query.output.fields.map((selection) => selection.key)).toEqual([
			"id",
			"properties",
			"externalId",
			"populatedAt",
			"entitySchemaSlug",
			"providerId",
			"translationStatus",
		]);
		expect(query.where).toMatchObject({
			type: "in",
			expr: { field: "id" },
			values: [{ value: "entity-1" }, { value: "entity-2" }],
		});
		expect(query.output.orderBy).toEqual([
			{ direction: "asc", expr: { type: "column", tableAlias: "entity", field: "id" } },
		]);
	});
});
