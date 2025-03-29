import { describe, expect, it } from "bun:test";
import { calculatePagination, mapQueryRowToItem } from "./query-builder";

describe("calculatePagination", () => {
	it("calculates the first page correctly", () => {
		expect(calculatePagination({ page: 1, limit: 5, total: 20 })).toEqual({
			page: 1,
			limit: 5,
			total: 20,
			totalPages: 4,
			hasNextPage: true,
			hasPreviousPage: false,
		});
	});

	it("keeps out-of-range pages unchanged", () => {
		expect(calculatePagination({ limit: 5, total: 20, page: 100 })).toEqual({
			limit: 5,
			total: 20,
			page: 100,
			totalPages: 4,
			hasNextPage: false,
			hasPreviousPage: true,
		});
	});

	it("returns consistent metadata for zero results", () => {
		expect(calculatePagination({ page: 1, total: 0, limit: 5 })).toEqual({
			page: 1,
			total: 0,
			limit: 5,
			totalPages: 0,
			hasNextPage: false,
			hasPreviousPage: false,
		});
	});

	it("marks the last page without a next page", () => {
		expect(calculatePagination({ page: 4, limit: 5, total: 20 })).toEqual({
			page: 4,
			total: 20,
			limit: 5,
			totalPages: 4,
			hasNextPage: false,
			hasPreviousPage: true,
		});
	});

	it("keeps the final partial page aligned to page boundaries", () => {
		expect(calculatePagination({ page: 3, limit: 10, total: 23 })).toEqual({
			page: 3,
			total: 23,
			limit: 10,
			totalPages: 3,
			hasNextPage: false,
			hasPreviousPage: true,
		});
	});
});

describe("mapQueryRowToItem", () => {
	it("keeps rows with empty string names", () => {
		expect(
			mapQueryRowToItem(
				{
					total: 1,
					name: "",
					image: null,
					cells: null,
					id: "entity-1",
					entity_schema_slug: "books",
					entity_schema_id: "schema-1",
					created_at: new Date("2024-01-01T00:00:00.000Z"),
					updated_at: new Date("2024-01-02T00:00:00.000Z"),
					resolved_properties: {
						titleProperty: { kind: "text", value: "" },
						imageProperty: { kind: "null", value: null },
						badgeProperty: { kind: "null", value: null },
						subtitleProperty: { kind: "null", value: null },
					},
				},
				"grid",
			),
		).toEqual({
			name: "",
			image: null,
			id: "entity-1",
			entitySchemaSlug: "books",
			entitySchemaId: "schema-1",
			createdAt: new Date("2024-01-01T00:00:00.000Z"),
			updatedAt: new Date("2024-01-02T00:00:00.000Z"),
			resolvedProperties: {
				titleProperty: { kind: "text", value: "" },
				badgeProperty: { kind: "null", value: null },
				imageProperty: { kind: "null", value: null },
				subtitleProperty: { kind: "null", value: null },
			},
		});
	});

	it("drops the left join sentinel row", () => {
		expect(
			mapQueryRowToItem(
				{
					total: 0,
					id: null,
					name: null,
					image: null,
					cells: null,
					created_at: null,
					updated_at: null,
					entity_schema_id: null,
					entity_schema_slug: null,
					resolved_properties: null,
				},
				"grid",
			),
		).toBeNull();
	});

	it("maps table rows to ordered cells", () => {
		expect(
			mapQueryRowToItem(
				{
					total: 1,
					image: null,
					id: "entity-1",
					name: "Entity",
					resolved_properties: null,
					entity_schema_slug: "books",
					entity_schema_id: "schema-1",
					created_at: new Date("2024-01-01T00:00:00.000Z"),
					updated_at: new Date("2024-01-02T00:00:00.000Z"),
					cells: [
						{ key: "column_0", kind: "text", value: "Entity" },
						{ key: "column_1", kind: "number", value: 2024 },
					],
				},
				"table",
			),
		).toEqual({
			image: null,
			id: "entity-1",
			name: "Entity",
			entitySchemaSlug: "books",
			entitySchemaId: "schema-1",
			createdAt: new Date("2024-01-01T00:00:00.000Z"),
			updatedAt: new Date("2024-01-02T00:00:00.000Z"),
			cells: [
				{ key: "column_0", kind: "text", value: "Entity" },
				{ key: "column_1", kind: "number", value: 2024 },
			],
		});
	});
});
