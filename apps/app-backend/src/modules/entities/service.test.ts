import { describe, expect, it } from "bun:test";
import {
	parseEntityProperties,
	resolveEntityCreateInput,
	resolveEntityId,
	resolveEntityName,
	resolveEntitySchemaId,
} from "./service";

describe("resolveEntityName", () => {
	it("trims the provided name", () => {
		expect(resolveEntityName("  My Entity  ")).toBe("My Entity");
	});

	it("throws when the name is blank", () => {
		expect(() => resolveEntityName("   ")).toThrow("Entity name is required");
	});
});

describe("resolveEntitySchemaId", () => {
	it("trims the provided entity schema id", () => {
		expect(resolveEntitySchemaId("  schema_123  ")).toBe("schema_123");
	});

	it("throws when the entity schema id is blank", () => {
		expect(() => resolveEntitySchemaId("   ")).toThrow(
			"Entity schema id is required",
		);
	});
});

describe("resolveEntityId", () => {
	it("trims the provided entity id", () => {
		expect(resolveEntityId("  entity_123  ")).toBe("entity_123");
	});

	it("throws when the entity id is blank", () => {
		expect(() => resolveEntityId("   ")).toThrow("Entity id is required");
	});
});

describe("parseEntityProperties", () => {
	it("validates properties against schema", () => {
		const propertiesSchema = {
			pages: { type: "integer" as const },
			title: { type: "string" as const, required: true as const },
		};

		const properties = { pages: 350, title: "My Book" };

		expect(
			parseEntityProperties({ properties, propertiesSchema }),
		).toMatchObject({ pages: 350, title: "My Book" });
	});

	it("accepts properties with optional fields missing", () => {
		const propertiesSchema = {
			pages: { type: "integer" as const },
			title: { type: "string" as const, required: true as const },
		};

		const properties = { title: "My Book" };

		expect(
			parseEntityProperties({ properties, propertiesSchema }),
		).toMatchObject({ title: "My Book" });
	});

	it("rejects properties missing required fields", () => {
		const propertiesSchema = {
			pages: { type: "integer" as const },
			title: { type: "string" as const, required: true as const },
		};

		const properties = { pages: 350 };

		expect(() =>
			parseEntityProperties({ properties, propertiesSchema }),
		).toThrow("Entity properties validation failed");
	});

	it("rejects properties with wrong type", () => {
		const propertiesSchema = {
			title: { type: "string" as const, required: true as const },
			pages: { type: "integer" as const },
		};

		const properties = {
			title: "My Book",
			pages: "not a number",
		};

		expect(() =>
			parseEntityProperties({ properties, propertiesSchema }),
		).toThrow("Entity properties validation failed");
	});

	it("rejects non-object properties", () => {
		const propertiesSchema = {
			title: { type: "string" as const },
		};

		expect(() =>
			parseEntityProperties({ properties: "not an object", propertiesSchema }),
		).toThrow("Entity properties must be a JSON object");
	});

	it("rejects array properties", () => {
		const propertiesSchema = {
			title: { type: "string" as const },
		};

		expect(() =>
			parseEntityProperties({ properties: [], propertiesSchema }),
		).toThrow("Entity properties must be a JSON object, not an array");
	});

	it("validates nested object properties", () => {
		const propertiesSchema = {
			metadata: {
				type: "object" as const,
				properties: {
					author: { type: "string" as const },
					year: { type: "integer" as const },
				},
			},
		};

		const properties = {
			metadata: { year: 2024, author: "John Doe" },
		};

		expect(
			parseEntityProperties({ properties, propertiesSchema }),
		).toMatchObject(properties);
	});
});

describe("resolveEntityCreateInput", () => {
	it("returns normalized payload", () => {
		const propertiesSchema = {
			title: { type: "string" as const, required: true as const },
			pages: { type: "integer" as const },
		};

		expect(
			resolveEntityCreateInput({
				name: "  My Book  ",
				properties: { title: "Test Book", pages: 200 },
				propertiesSchema,
			}),
		).toEqual({
			name: "My Book",
			properties: { title: "Test Book", pages: 200 },
		});
	});
});
