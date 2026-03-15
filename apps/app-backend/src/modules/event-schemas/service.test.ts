import { describe, expect, it } from "bun:test";
import {
	parseEventSchemaPropertiesSchema,
	resolveEventSchemaCreateInput,
	resolveEventSchemaEntitySchemaId,
	resolveEventSchemaName,
	resolveEventSchemaSlug,
} from "./service";

describe("resolveEventSchemaName", () => {
	it("trims the provided name", () => {
		expect(resolveEventSchemaName("  Reading Progress  ")).toBe(
			"Reading Progress",
		);
	});

	it("throws when the name is blank", () => {
		expect(() => resolveEventSchemaName("   ")).toThrow(
			"Event schema name is required",
		);
	});
});

describe("resolveEventSchemaEntitySchemaId", () => {
	it("trims the provided entity schema id", () => {
		expect(resolveEventSchemaEntitySchemaId("  entity_schema_123  ")).toBe(
			"entity_schema_123",
		);
	});

	it("throws when the entity schema id is blank", () => {
		expect(() => resolveEventSchemaEntitySchemaId("   ")).toThrow(
			"Entity schema id is required",
		);
	});
});

describe("resolveEventSchemaSlug", () => {
	it("normalizes the provided slug", () => {
		expect(
			resolveEventSchemaSlug({
				name: "Reading Progress",
				slug: "  Reading_Progress  ",
			}),
		).toBe("reading-progress");
	});

	it("falls back to the name when no slug is provided", () => {
		expect(resolveEventSchemaSlug({ name: "Reading Progress" })).toBe(
			"reading-progress",
		);
	});
});

describe("parseEventSchemaPropertiesSchema", () => {
	it("accepts flat properties map", () => {
		expect(
			parseEventSchemaPropertiesSchema({
				note: { type: "string" },
				progress: { type: "integer" },
			}),
		).toEqual({
			note: { type: "string" },
			progress: { type: "integer" },
		});
	});

	it("accepts already-parsed properties map", () => {
		const schema = {
			note: { type: "string" as const },
			progress: { type: "integer" as const },
		};

		expect(parseEventSchemaPropertiesSchema(schema)).toEqual(schema);
	});

	it("rejects non-object roots", () => {
		expect(() => parseEventSchemaPropertiesSchema([])).toThrow(
			"Event schema properties schema must be a JSON object",
		);
	});

	it("rejects string inputs", () => {
		expect(() =>
			parseEventSchemaPropertiesSchema('{"progress":{"type":"integer"}}'),
		).toThrow("Event schema properties schema must be a JSON object");
	});

	it("rejects empty properties map", () => {
		expect(() => parseEventSchemaPropertiesSchema({})).toThrow(
			"Event schema properties must contain at least one property",
		);
	});

	it("rejects array property without items", () => {
		expect(() =>
			parseEventSchemaPropertiesSchema({ checkpoints: { type: "array" } }),
		).toThrow(
			'Property "checkpoints" with type "array" must have an items field',
		);
	});
});

describe("resolveEventSchemaCreateInput", () => {
	it("returns normalized payload", () => {
		expect(
			resolveEventSchemaCreateInput({
				name: "  Reading Progress  ",
				slug: "  Reading_Progress  ",
				propertiesSchema: { progress: { type: "integer" } },
			}),
		).toEqual({
			name: "Reading Progress",
			slug: "reading-progress",
			propertiesSchema: { progress: { type: "integer" } },
		});
	});
});
