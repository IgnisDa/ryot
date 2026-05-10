import { describe, expect, it } from "bun:test";

import { getQueryEngineField } from "./query-engine";

describe("getQueryEngineField", () => {
	it("returns keyed fields from records", () => {
		expect(getQueryEngineField({ title: { kind: "text", value: "Dune" } }, "title")).toEqual({
			key: "title",
			kind: "text",
			value: "Dune",
		});
	});

	it("returns undefined for missing keys", () => {
		expect(
			getQueryEngineField({ title: { kind: "text", value: "Dune" } }, "missing"),
		).toBeUndefined();
	});

	it("returns undefined for missing records", () => {
		expect(getQueryEngineField(undefined, "title")).toBeUndefined();
	});

	it("ignores inherited object properties", () => {
		expect(
			getQueryEngineField({ title: { kind: "text", value: "Dune" } }, "toString"),
		).toBeUndefined();
	});
});
