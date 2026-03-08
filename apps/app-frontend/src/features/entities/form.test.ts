import { describe, expect, it } from "bun:test";
import {
	buildCreateEntityFormSchema,
	buildDefaultEntityFormValues,
	toCreateEntityPayload,
} from "./form";

describe("buildCreateEntityFormSchema", () => {
	it("builds schema for simple string and number properties", () => {
		const propertiesSchema = {
			title: { type: "string" as const, required: true as const },
			pages: { type: "integer" as const },
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: { pages: 350, title: "The Great Book" },
		});

		expect(result.success).toBeTrue();
	});

	it("rejects invalid property types", () => {
		const propertiesSchema = {
			title: { type: "string" as const, required: true as const },
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: { title: 123 },
		});

		expect(result.success).toBeFalse();
	});

	it("requires required properties", () => {
		const propertiesSchema = {
			title: { type: "string" as const, required: true as const },
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({ properties: {}, name: "Test Book" });

		expect(result.success).toBeFalse();
	});

	it("allows optional properties to be missing", () => {
		const propertiesSchema = {
			subtitle: { type: "string" as const },
			title: { type: "string" as const, required: true as const },
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: { title: "The Great Book" },
		});

		expect(result.success).toBeTrue();
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

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: { metadata: { year: 2024, author: "John Doe" } },
		});

		expect(result.success).toBeTrue();
	});

	it("validates array properties", () => {
		const propertiesSchema = {
			tags: {
				type: "array" as const,
				items: { type: "string" as const },
			},
		};

		const schema = buildCreateEntityFormSchema(propertiesSchema);

		const result = schema.safeParse({
			name: "Test Book",
			properties: { tags: ["fiction", "adventure"] },
		});

		expect(result.success).toBeTrue();
	});
});

describe("buildDefaultEntityFormValues", () => {
	it("creates default values with empty name and required properties", () => {
		const propertiesSchema = {
			pages: { type: "integer" as const },
			title: { type: "string" as const, required: true as const },
		};

		const values = buildDefaultEntityFormValues(propertiesSchema);

		expect(values.name).toBe("");
		expect(values.properties).toMatchObject({ title: "" });
		expect(values.properties.pages).toBeUndefined();
	});

	it("includes default values for all property types", () => {
		const propertiesSchema = {
			title: { type: "string" as const, required: true as const },
			pages: { type: "integer" as const, required: true as const },
			active: { type: "boolean" as const, required: true as const },
		};

		const values = buildDefaultEntityFormValues(propertiesSchema);

		expect(values.properties).toMatchObject({
			pages: 0,
			title: "",
			active: false,
		});
	});

	it("creates default values for nested object properties", () => {
		const propertiesSchema = {
			metadata: {
				type: "object" as const,
				required: true as const,
				properties: {
					year: { type: "integer" as const },
					author: { type: "string" as const },
				},
			},
		};

		const values = buildDefaultEntityFormValues(propertiesSchema);

		expect(values.properties.metadata).toEqual({ year: 0, author: "" });
	});
});

describe("toCreateEntityPayload", () => {
	it("trims name and includes entitySchemaId and properties", () => {
		const formValues = {
			name: "  Test Book  ",
			properties: { pages: 350, title: "The Great Book" },
		};

		const payload = toCreateEntityPayload(formValues, "schema-123");

		expect(payload).toEqual({
			name: "Test Book",
			entitySchemaId: "schema-123",
			properties: { pages: 350, title: "The Great Book" },
		});
	});
});
