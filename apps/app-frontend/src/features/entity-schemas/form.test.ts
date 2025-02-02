import { describe, expect, it } from "bun:test";
import { resolveNextPropertySchemaSlug } from "../property-schemas/form";
import {
	buildDefaultEntitySchemaPropertyRow,
	buildEntitySchemaFormValues,
	buildEntitySchemaPropertiesSchema,
	createEntitySchemaFormSchema,
	defaultCreateEntitySchemaFormValues,
	isEntitySchemaPropertyRowsValid,
	toCreateEntitySchemaPayload,
} from "./form";

describe("buildDefaultEntitySchemaPropertyRow", () => {
	it("returns an empty optional string property row", () => {
		const row = buildDefaultEntitySchemaPropertyRow();

		expect(row).toMatchObject({
			key: "",
			type: "string",
			required: false,
		});
		expect(row.id).toEqual(expect.any(String));
	});
});

describe("buildEntitySchemaFormValues", () => {
	it("returns default values with one property row", () => {
		const values = buildEntitySchemaFormValues();
		const row = values.properties[0];

		if (!row) throw new Error("Expected a default property row");

		expect(values.name).toBe("");
		expect(values.slug).toBe("");
		expect(values.icon).toBe("");
		expect(values.accentColor).toBe("");
		expect(values.properties).toHaveLength(1);
		expect(row).toMatchObject({
			key: "",
			type: "string",
			required: false,
		});
		expect(row.id).toEqual(expect.any(String));
	});

	it("exports the default create values", () => {
		const row = defaultCreateEntitySchemaFormValues.properties[0];

		if (!row) throw new Error("Expected an exported default property row");

		expect(defaultCreateEntitySchemaFormValues.name).toBe("");
		expect(defaultCreateEntitySchemaFormValues.slug).toBe("");
		expect(defaultCreateEntitySchemaFormValues.icon).toBe("");
		expect(defaultCreateEntitySchemaFormValues.accentColor).toBe("");
		expect(defaultCreateEntitySchemaFormValues.properties).toHaveLength(1);
		expect(row).toMatchObject({
			key: "",
			type: "string",
			required: false,
		});
		expect(row.id).toEqual(expect.any(String));
	});

	it("maps existing values into form defaults", () => {
		const properties = [
			{ key: "title", type: "string" as const, required: true as const },
		];
		const inputRow = properties[0];

		if (!inputRow) throw new Error("Expected an input property row");

		const values = buildEntitySchemaFormValues({
			properties,
			icon: "book-open",
			name: "Custom Schema",
			slug: "custom-schema",
			accentColor: "#5B7FFF",
		});
		const row = values.properties[0];

		if (!row) throw new Error("Expected a mapped property row");

		expect(values.name).toBe("Custom Schema");
		expect(values.slug).toBe("custom-schema");
		expect(values.icon).toBe("book-open");
		expect(values.accentColor).toBe("#5B7FFF");
		expect(values.properties).toHaveLength(1);
		expect(row).toMatchObject(inputRow);
		expect(row.id).toEqual(expect.any(String));
	});

	it("normalizes an empty properties array to one default row", () => {
		const values = buildEntitySchemaFormValues({ properties: [] });
		const row = values.properties[0];

		if (!row) throw new Error("Expected a normalized property row");

		expect(values.properties).toHaveLength(1);
		expect(values.icon).toBe("");
		expect(values.accentColor).toBe("");
		expect(row).toMatchObject({
			key: "",
			type: "string",
			required: false,
		});
		expect(row.id).toEqual(expect.any(String));
	});
});

describe("resolveNextPropertySchemaSlug", () => {
	it("derives the slug while it is blank", () => {
		expect(
			resolveNextPropertySchemaSlug({
				slug: "",
				name: "  Shelf Status  ",
				previousDerivedSlug: "shelf",
			}),
		).toBe("shelf-status");
	});

	it("keeps auto-updating when the slug still matches the previous derivation", () => {
		expect(
			resolveNextPropertySchemaSlug({
				name: "Reading Status",
				slug: "reading-status-old",
				previousDerivedSlug: "reading-status-old",
			}),
		).toBe("reading-status");
	});

	it("treats a whitespace-only slug as blank", () => {
		expect(
			resolveNextPropertySchemaSlug({
				slug: "  \n\t ",
				name: "Reading Status",
				previousDerivedSlug: "reading-status-old",
			}),
		).toBe("reading-status");
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
	it("rejects a whitespace-only name but allows a blank slug", () => {
		const result = createEntitySchemaFormSchema.safeParse({
			name: "  \n\t ",
			slug: "  \n\t ",
			icon: "book-open",
			accentColor: "#5B7FFF",
			properties: [
				{ id: "title", key: "title", type: "string", required: false },
			],
		});

		expect(result.success).toBeFalse();

		if (result.success) return;

		expect(result.error.issues).toContainEqual({
			code: "custom",
			path: ["name"],
			message: "Name is required",
		});
	});

	it("accepts a blank slug so the backend can derive it", () => {
		const result = createEntitySchemaFormSchema.safeParse({
			name: "Books",
			slug: "  \n\t ",
			icon: "book-open",
			accentColor: "#5B7FFF",
			properties: [
				{ id: "title", key: "title", type: "string", required: false },
			],
		});

		expect(result.success).toBeTrue();
	});

	it("rejects empty property rows", () => {
		const result = createEntitySchemaFormSchema.safeParse({
			name: "Books",
			slug: "books",
			icon: "book-open",
			accentColor: "#5B7FFF",
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
			{ id: "title", key: "title", type: "string", required: false },
			{ id: "rating", key: " title ", type: "number", required: true },
		] as const;
		const result = createEntitySchemaFormSchema.safeParse({
			properties,
			name: "Books",
			slug: "books",
			icon: "book-open",
			accentColor: "#5B7FFF",
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
			{ id: "title", key: " \n\t ", type: "string", required: false },
		] as const;
		const result = createEntitySchemaFormSchema.safeParse({
			properties,
			name: "Books",
			slug: "books",
			icon: "book-open",
			accentColor: "#5B7FFF",
		});

		expect(result.success).toBeFalse();

		if (result.success) return;

		expect(result.error.issues).toContainEqual({
			code: "custom",
			path: ["properties"],
			message: "Properties must contain unique non-empty keys",
		});
	});

	it("rejects missing icon and accent color", () => {
		const result = createEntitySchemaFormSchema.safeParse({
			icon: "",
			name: "Books",
			slug: "books",
			accentColor: "",
			properties: [
				{ id: "title", key: "title", type: "string", required: false },
			],
		});

		expect(result.success).toBeFalse();
	});

	it("accepts valid values", () => {
		const result = createEntitySchemaFormSchema.safeParse({
			name: "Books",
			slug: "books",
			icon: "book-open",
			accentColor: "#5B7FFF",
			properties: [
				{ id: "title", key: "title", type: "string", required: true },
				{
					id: "published-at",
					key: "publishedAt",
					type: "date",
					required: false,
				},
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

describe("toCreateEntitySchemaPayload", () => {
	it("trims name and slug, includes facetId, and serializes property rows", () => {
		expect(
			toCreateEntitySchemaPayload(
				{
					slug: " books ",
					name: "  Books  ",
					icon: "  book-open  ",
					accentColor: "  #5B7FFF  ",
					properties: [
						{
							id: "released-on",
							key: " releasedOn ",
							type: "date",
							required: true,
						},
						{
							id: "rating",
							key: "rating",
							type: "number",
							required: false,
						},
					],
				},
				"facet-123",
			),
		).toEqual({
			name: "Books",
			slug: "books",
			icon: "book-open",
			accentColor: "#5B7FFF",
			facetId: "facet-123",
			propertiesSchema: {
				releasedOn: { type: "date", required: true },
				rating: { type: "number" },
			},
		});
	});

	it("omits slug when the input is blank", () => {
		expect(
			toCreateEntitySchemaPayload(
				{
					slug: "  \n\t ",
					icon: "book-open",
					name: "  Books  ",
					accentColor: "#5B7FFF",
					properties: [
						{ id: "title", key: "title", type: "string", required: false },
					],
				},
				"facet-123",
			),
		).toEqual({
			name: "Books",
			icon: "book-open",
			accentColor: "#5B7FFF",
			facetId: "facet-123",
			propertiesSchema: { title: { type: "string" } },
		});
	});
});
