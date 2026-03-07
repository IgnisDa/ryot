import { describe, expect, it } from "bun:test";
import {
	buildDefaultEntitySchemaPropertyRow,
	buildEntitySchemaFormValues,
	buildEntitySchemaPropertiesSchema,
	createEntitySchemaFormSchema,
	defaultCreateEntitySchemaFormValues,
	isEntitySchemaPropertyRowsValid,
	serializeEntitySchemaProperties,
	toCreateEntitySchemaPayload,
} from "./form";

describe("buildDefaultEntitySchemaPropertyRow", () => {
	it("returns an empty optional string property row", () => {
		expect(buildDefaultEntitySchemaPropertyRow()).toEqual({
			key: "",
			type: "string",
			required: false,
		});
	});
});

describe("buildEntitySchemaFormValues", () => {
	it("returns default values with one property row", () => {
		const values = buildEntitySchemaFormValues();

		expect(values).toEqual({
			name: "",
			slug: "",
			properties: [buildDefaultEntitySchemaPropertyRow()],
		});
	});

	it("exports the default create values", () => {
		expect(defaultCreateEntitySchemaFormValues).toEqual(
			buildEntitySchemaFormValues(),
		);
	});

	it("maps existing values into form defaults", () => {
		const properties = [
			{ key: "title", type: "string" as const, required: true as const },
		];

		const values = buildEntitySchemaFormValues({
			properties,
			name: "Custom Schema",
			slug: "custom-schema",
		});

		expect(values).toEqual({
			properties,
			name: "Custom Schema",
			slug: "custom-schema",
		});
	});

	it("normalizes an empty properties array to one default row", () => {
		expect(buildEntitySchemaFormValues({ properties: [] }).properties).toEqual([
			buildDefaultEntitySchemaPropertyRow(),
		]);
	});
});

describe("isEntitySchemaPropertyRowsValid", () => {
	it("returns false when there are no property rows", () => {
		expect(isEntitySchemaPropertyRowsValid([])).toBeFalse();
	});

	it("returns false when a trimmed key is empty", () => {
		expect(
			isEntitySchemaPropertyRowsValid([buildDefaultEntitySchemaPropertyRow()]),
		).toBeFalse();
	});

	it("returns false when trimmed keys are duplicated", () => {
		expect(
			isEntitySchemaPropertyRowsValid([
				{ key: "title", type: "string", required: false },
				{ key: " title ", type: "number", required: true },
			]),
		).toBeFalse();
	});

	it("returns true for unique non-empty trimmed keys", () => {
		expect(
			isEntitySchemaPropertyRowsValid([
				{ key: " title ", type: "string", required: false },
				{ key: "publishedAt", type: "date", required: true },
			]),
		).toBeTrue();
	});
});

describe("createEntitySchemaFormSchema", () => {
	it("rejects whitespace-only name and slug values", () => {
		const result = createEntitySchemaFormSchema.safeParse({
			name: "  \n\t ",
			slug: "  \n\t ",
			properties: [{ key: "title", type: "string", required: false }],
		});

		expect(result.success).toBeFalse();

		if (result.success) return;

		expect(result.error.issues).toContainEqual({
			code: "custom",
			path: ["name"],
			message: "Name is required",
		});
		expect(result.error.issues).toContainEqual({
			code: "custom",
			path: ["slug"],
			message: "Slug is required",
		});
	});

	it("rejects empty property rows", () => {
		const result = createEntitySchemaFormSchema.safeParse({
			name: "Books",
			slug: "books",
			properties: [],
		});

		expect(result.success).toBeFalse();

		if (result.success) return;

		expect(result.error.issues).toContainEqual({
			code: "custom",
			path: ["properties"],
			message: "Properties must contain unique non-empty keys",
		});
	});

	it("rejects duplicate trimmed property keys", () => {
		const properties = [
			{ key: "title", type: "string", required: false },
			{ key: " title ", type: "number", required: true },
		] as const;
		const result = createEntitySchemaFormSchema.safeParse({
			properties,
			name: "Books",
			slug: "books",
		});

		expect(result.success).toBeFalse();

		if (result.success) return;

		expect(result.error.issues).toContainEqual({
			code: "custom",
			path: ["properties"],
			message: "Properties must contain unique non-empty keys",
		});
	});

	it("rejects a whitespace-only property key after trimming", () => {
		const properties = [
			{ key: " \n\t ", type: "string", required: false },
		] as const;
		const result = createEntitySchemaFormSchema.safeParse({
			properties,
			name: "Books",
			slug: "books",
		});

		expect(result.success).toBeFalse();

		if (result.success) return;

		expect(result.error.issues).toContainEqual({
			code: "custom",
			path: ["properties"],
			message: "Properties must contain unique non-empty keys",
		});
	});

	it("accepts valid values", () => {
		const result = createEntitySchemaFormSchema.safeParse({
			name: "Books",
			slug: "books",
			properties: [
				{ key: "title", type: "string", required: true },
				{ key: "publishedAt", type: "date", required: false },
			],
		});

		expect(result.success).toBeTrue();
	});
});

describe("buildEntitySchemaPropertiesSchema", () => {
	it("maps scalar property types and trims keys", () => {
		expect(
			buildEntitySchemaPropertiesSchema([
				{ key: " title ", type: "string", required: false },
				{ key: "rating", type: "number", required: false },
				{ key: "isOwned", type: "boolean", required: false },
			]),
		).toEqual({
			title: { type: "string" },
			rating: { type: "number" },
			isOwned: { type: "boolean" },
		});
	});

	it("maps integer type correctly", () => {
		expect(
			buildEntitySchemaPropertiesSchema([
				{ key: "pages", type: "integer", required: false },
			]),
		).toEqual({ pages: { type: "integer" } });
	});

	it("maps date rows and includes required flag when present", () => {
		expect(
			buildEntitySchemaPropertiesSchema([
				{ key: "releasedOn", type: "date", required: true },
				{ key: "summary", type: "string", required: false },
			]),
		).toEqual({
			summary: { type: "string" },
			releasedOn: { type: "date", required: true },
		});
	});
});

describe("serializeEntitySchemaProperties", () => {
	it("returns deterministic JSON without required flag for optional rows", () => {
		expect(
			serializeEntitySchemaProperties([
				{ key: " title ", type: "string", required: false },
				{ key: "rating", type: "number", required: false },
			]),
		).toBe('{"title":{"type":"string"},"rating":{"type":"number"}}');
	});

	it("returns deterministic JSON with required flag for date rows", () => {
		expect(
			serializeEntitySchemaProperties([
				{ key: "releasedOn", type: "date", required: true },
			]),
		).toBe('{"releasedOn":{"type":"date","required":true}}');
	});
});

describe("toCreateEntitySchemaPayload", () => {
	it("trims name and slug, includes facetId, and serializes property rows", () => {
		expect(
			toCreateEntitySchemaPayload(
				{
					slug: " books ",
					name: "  Books  ",
					properties: [
						{ key: " releasedOn ", type: "date", required: true },
						{ key: "rating", type: "number", required: false },
					],
				},
				"facet-123",
			),
		).toEqual({
			name: "Books",
			slug: "books",
			facetId: "facet-123",
			propertiesSchema:
				'{"releasedOn":{"type":"date","required":true},"rating":{"type":"number"}}',
		});
	});
});
