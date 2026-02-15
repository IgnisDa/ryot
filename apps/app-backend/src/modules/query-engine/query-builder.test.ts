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
	it("keeps rows with empty string field values", () => {
		expect(
			mapQueryRowToItem({
				total: 1,
				row_id: "entity-1",
				fields: [
					{ key: "title", kind: "text", value: "" },
					{ key: "image", kind: "null", value: null },
				],
			}),
		).toEqual([
			{ key: "title", kind: "text", value: "" },
			{ key: "image", kind: "null", value: null },
		]);
	});

	it("drops the left join sentinel row", () => {
		expect(
			mapQueryRowToItem({
				total: 0,
				row_id: null,
				fields: null,
			}),
		).toBeNull();
	});

	it("maps rows to ordered resolved fields", () => {
		expect(
			mapQueryRowToItem({
				total: 1,
				row_id: "entity-1",
				fields: [
					{ key: "column_0", kind: "text", value: "Entity" },
					{ key: "column_1", kind: "number", value: 2024 },
				],
			}),
		).toEqual([
			{ key: "column_0", kind: "text", value: "Entity" },
			{ key: "column_1", kind: "number", value: 2024 },
		]);
	});
});
