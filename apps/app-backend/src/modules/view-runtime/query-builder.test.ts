import { describe, expect, it } from "bun:test";
import { calculatePagination } from "./query-builder";

describe("calculatePagination", () => {
	it("calculates the first page correctly", () => {
		expect(
			calculatePagination({
				limit: 5,
				total: 20,
				offset: 0,
			}),
		).toEqual({
			limit: 5,
			total: 20,
			offset: 0,
			totalPages: 4,
			currentPage: 1,
			hasNextPage: true,
			hasPreviousPage: false,
		});
	});

	it("clamps offsets beyond the last page", () => {
		expect(
			calculatePagination({
				limit: 5,
				total: 20,
				offset: 100,
			}),
		).toEqual({
			limit: 5,
			total: 20,
			offset: 15,
			totalPages: 4,
			currentPage: 4,
			hasNextPage: false,
			hasPreviousPage: true,
		});
	});

	it("returns consistent metadata for zero results", () => {
		expect(
			calculatePagination({
				total: 0,
				limit: 5,
				offset: 0,
			}),
		).toEqual({
			total: 0,
			limit: 5,
			offset: 0,
			totalPages: 0,
			currentPage: 1,
			hasNextPage: false,
			hasPreviousPage: false,
		});
	});

	it("marks the last page without a next page", () => {
		expect(
			calculatePagination({
				limit: 5,
				total: 20,
				offset: 15,
			}),
		).toEqual({
			total: 20,
			limit: 5,
			offset: 15,
			totalPages: 4,
			currentPage: 4,
			hasNextPage: false,
			hasPreviousPage: true,
		});
	});
});
