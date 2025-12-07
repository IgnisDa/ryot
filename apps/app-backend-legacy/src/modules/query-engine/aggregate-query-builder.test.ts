import { describe, expect, it } from "bun:test";

import { mapAggregateValue } from "./aggregate-query-builder";

describe("mapAggregateValue", () => {
	it("returns kind 'number' for count with a positive value", () => {
		expect(mapAggregateValue({ key: "total", value: 5, type: "count" })).toEqual({
			key: "total",
			kind: "number",
			value: 5,
		});
	});

	it("returns kind 'number' for count with value 0 (empty filtered set)", () => {
		expect(mapAggregateValue({ key: "total", value: 0, type: "count" })).toEqual({
			key: "total",
			kind: "number",
			value: 0,
		});
	});

	it("returns kind 'number' for countWhere with a positive value", () => {
		expect(mapAggregateValue({ key: "recent", value: 3, type: "countWhere" })).toEqual({
			key: "recent",
			kind: "number",
			value: 3,
		});
	});

	it("returns kind 'null' for avg/sum/min/max when the set is empty (SQL returns null)", () => {
		for (const type of ["avg", "sum", "min", "max"] as const) {
			expect(mapAggregateValue({ key: "x", value: null, type })).toEqual({
				key: "x",
				kind: "null",
				value: null,
			});
		}
	});

	it("returns kind 'number' for avg/sum/min/max when the set is non-empty", () => {
		const expected = {
			key: "x",
			value: 42.5,
			kind: "number" as const,
		};
		for (const type of ["avg", "sum", "min", "max"] as const) {
			expect(mapAggregateValue({ key: "x", value: 42.5, type })).toEqual(expected);
		}
	});

	it("returns kind 'json' for countBy with an object value", () => {
		expect(
			mapAggregateValue({
				key: "bySchema",
				type: "countBy",
				value: { book: 3, movie: 2 },
			}),
		).toEqual({ key: "bySchema", kind: "json", value: { book: 3, movie: 2 } });
	});

	it("returns empty object for countBy when value is null (empty filtered set)", () => {
		expect(mapAggregateValue({ key: "bySchema", value: null, type: "countBy" })).toEqual({
			key: "bySchema",
			kind: "json",
			value: {},
		});
	});

	it("preserves the key through all aggregation types", () => {
		for (const type of ["count", "countWhere", "sum", "avg", "min", "max"] as const) {
			const result = mapAggregateValue({ key: "myKey", value: 1, type });
			expect(result.key).toBe("myKey");
		}
	});
});
