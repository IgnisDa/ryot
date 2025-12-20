import { describe, expect, it } from "vitest";

import { mapAggregateValue } from "./aggregate-query-builder";

describe("mapAggregateValue", () => {
	it("returns kind 'number' for count with a positive value", () => {
		expect(mapAggregateValue({ key: "total", value: 5, type: "count" })).toEqual({
			key: "total",
			kind: "number",
			value: 5,
		});
	});

	it("returns kind 'number' for count with value 0", () => {
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

	it.each(["avg", "sum", "min", "max"] as const)(
		"returns kind 'null' for %s when the set is empty",
		(type) => {
			expect(mapAggregateValue({ key: "x", value: null, type })).toEqual({
				key: "x",
				kind: "null",
				value: null,
			});
		},
	);

	it.each(["avg", "sum", "min", "max"] as const)(
		"returns kind 'number' for %s when the set is non-empty",
		(type) => {
			expect(mapAggregateValue({ key: "x", value: 42.5, type })).toEqual({
				key: "x",
				kind: "number",
				value: 42.5,
			});
		},
	);

	it("returns kind 'json' for countBy with an object value", () => {
		expect(
			mapAggregateValue({
				key: "bySchema",
				type: "countBy",
				value: { book: 3, movie: 2 },
			}),
		).toEqual({ key: "bySchema", kind: "json", value: { book: 3, movie: 2 } });
	});

	it("returns an empty object for countBy when value is null", () => {
		expect(mapAggregateValue({ key: "bySchema", value: null, type: "countBy" })).toEqual({
			key: "bySchema",
			kind: "json",
			value: {},
		});
	});

	it.each(["count", "countWhere", "sum", "avg", "min", "max"] as const)(
		"preserves the key for %s",
		(type) => {
			expect(mapAggregateValue({ key: "myKey", value: 1, type }).key).toBe("myKey");
		},
	);
});
