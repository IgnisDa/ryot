import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { FieldSelector } from "./language";

const decodeSync = Schema.decodeUnknownSync;

describe("FieldSelector", () => {
	it("decodes a system field selector", () => {
		const result = decodeSync(FieldSelector)({ type: "system", name: "id" });
		expect(result).toEqual({ type: "system", name: "id" });
	});

	it("decodes a property field selector", () => {
		const result = decodeSync(FieldSelector)({
			path: ["title"],
			schema: "books",
			type: "property",
		});
		expect(result).toEqual({ type: "property", schema: "books", path: ["title"] });
	});

	it("decodes a property field selector with a nested path", () => {
		const result = decodeSync(FieldSelector)({
			schema: "books",
			type: "property",
			path: ["meta", "publisher"],
		});
		expect(result).toEqual({ type: "property", schema: "books", path: ["meta", "publisher"] });
	});

	it("decodes a schema metadata selector for 'slug'", () => {
		const result = decodeSync(FieldSelector)({ type: "schema", name: "slug" });
		expect(result).toEqual({ type: "schema", name: "slug" });
	});

	it("decodes a schema metadata selector for 'name'", () => {
		const result = decodeSync(FieldSelector)({ type: "schema", name: "name" });
		expect(result).toEqual({ type: "schema", name: "name" });
	});

	it("throws for an unknown selector type", () => {
		expect(() => decodeSync(FieldSelector)({ type: "unknown" })).toThrow();
	});

	it("throws when a field selector has an excess property", () => {
		expect(() => decodeSync(FieldSelector)({ type: "system", name: "id", path: ["id"] })).toThrow();
	});

	it("throws for a schema metadata selector with an invalid name", () => {
		expect(() => decodeSync(FieldSelector)({ type: "schema", name: "id" })).toThrow();
	});
});
