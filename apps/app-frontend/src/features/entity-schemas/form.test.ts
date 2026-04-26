import { describe, expect, it } from "bun:test";
import {
	createPropertySchemaInputFixture,
	createPropertySchemaRowFixture,
} from "~/features/test-fixtures";
import {
	buildDefaultEntitySchemaPropertyRow,
	buildEntitySchemaFormValues,
	buildEntitySchemaPropertiesSchema,
	createEntitySchemaFormSchema,
	defaultCreateEntitySchemaFormValues,
	isEntitySchemaPropertyRowsValid,
	toCreateEntitySchemaPayload,
} from "./form";

const input = createPropertySchemaInputFixture;
const row = createPropertySchemaRowFixture;

describe("buildDefaultEntitySchemaPropertyRow", () => {
	it("returns an empty optional string property row", () => {
		const row = buildDefaultEntitySchemaPropertyRow();

		expect(row).toMatchObject({
			key: "",
			label: "",
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

		if (!row) {
			throw new Error("Expected a default property row");
		}

		expect(values.name).toBe("");
		expect(values.slug).toBe("");
		expect(values.icon).toBe("");
		expect(values.accentColor).toBe("");
		expect(values.properties).toHaveLength(1);
		expect(row).toMatchObject({
			key: "",
			label: "",
			type: "string",
			required: false,
		});
		expect(row.id).toEqual(expect.any(String));
	});

	it("exports the default create values", () => {
		const row = defaultCreateEntitySchemaFormValues.properties[0];

		if (!row) {
			throw new Error("Expected an exported default property row");
		}

		expect(defaultCreateEntitySchemaFormValues.name).toBe("");
		expect(defaultCreateEntitySchemaFormValues.slug).toBe("");
		expect(defaultCreateEntitySchemaFormValues.icon).toBe("");
		expect(defaultCreateEntitySchemaFormValues.accentColor).toBe("");
		expect(defaultCreateEntitySchemaFormValues.properties).toHaveLength(1);
		expect(row).toMatchObject({
			key: "",
			label: "",
			type: "string",
			required: false,
		});
		expect(row.id).toEqual(expect.any(String));
	});

	it("maps existing values into form defaults", () => {
		const properties = [input({ key: "title", required: true })];
		const inputRow = properties[0];

		if (!inputRow) {
			throw new Error("Expected an input property row");
		}

		const values = buildEntitySchemaFormValues({
			properties,
			icon: "book-open",
			name: "Custom Schema",
			slug: "custom-schema",
			accentColor: "#5B7FFF",
		});
		const row = values.properties[0];

		if (!row) {
			throw new Error("Expected a mapped property row");
		}

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

		if (!row) {
			throw new Error("Expected a normalized property row");
		}

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
				input({ key: "title" }),
				input({ key: " title ", type: "number", required: true }),
			]),
		).toBeFalse();
	});

	it("returns true for unique non-empty trimmed keys", () => {
		expect(
			isEntitySchemaPropertyRowsValid([
				input({ key: " title " }),
				input({ key: "publishedAt", type: "date", required: true }),
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
			properties: [row({ id: "title", key: "title" })],
		});

		expect(result.success).toBeFalse();

		if (result.success) {
			return;
		}

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
			properties: [row({ id: "title", key: "title" })],
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

		if (result.success) {
			return;
		}

		expect(result.error.issues).toContainEqual({
			code: "custom",
			path: ["properties"],
			message: "Properties must contain unique non-empty keys",
		});
	});

	it("rejects duplicate trimmed property keys", () => {
		const properties = [
			row({ id: "title", key: "title" }),
			row({ id: "rating", key: " title ", type: "number", required: true }),
		] as const;
		const result = createEntitySchemaFormSchema.safeParse({
			properties,
			name: "Books",
			slug: "books",
			icon: "book-open",
			accentColor: "#5B7FFF",
		});

		expect(result.success).toBeFalse();

		if (result.success) {
			return;
		}

		expect(result.error.issues).toContainEqual({
			code: "custom",
			path: ["properties"],
			message: "Properties must contain unique non-empty keys",
		});
	});

	it("rejects a whitespace-only property key after trimming", () => {
		const properties = [row({ id: "title", key: " \n\t " })] as const;
		const result = createEntitySchemaFormSchema.safeParse({
			properties,
			name: "Books",
			slug: "books",
			icon: "book-open",
			accentColor: "#5B7FFF",
		});

		expect(result.success).toBeFalse();

		if (result.success) {
			return;
		}

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
			properties: [row({ id: "title", key: "title" })],
		});

		expect(result.success).toBeFalse();
	});
});

describe("buildEntitySchemaPropertiesSchema", () => {
	it("maps scalar property types and trims keys", () => {
		expect(
			buildEntitySchemaPropertiesSchema([
				input({ key: " title " }),
				input({ key: "rating", type: "number" }),
				input({ key: "isOwned", type: "boolean" }),
			]),
		).toEqual({
			fields: {
				title: { label: "Title", type: "string" },
				rating: { label: "Title", type: "number" },
				isOwned: { label: "Title", type: "boolean" },
			},
		});
	});

	it("maps integer type correctly", () => {
		expect(
			buildEntitySchemaPropertiesSchema([
				input({ key: "pages", type: "integer" }),
			]),
		).toEqual({ fields: { pages: { label: "Title", type: "integer" } } });
	});

	it("maps date rows and includes required flag when present", () => {
		expect(
			buildEntitySchemaPropertiesSchema([
				input({ key: "releasedOn", type: "date", required: true }),
				input({ key: "summary" }),
			]),
		).toEqual({
			fields: {
				summary: { label: "Title", type: "string" },
				releasedOn: {
					type: "date",
					label: "Title",
					validation: { required: true },
				},
			},
		});
	});
});

describe("toCreateEntitySchemaPayload", () => {
	it("trims name and slug, includes trackerId, and serializes property rows", () => {
		expect(
			toCreateEntitySchemaPayload(
				{
					slug: " books ",
					name: "  Books  ",
					icon: "  book-open  ",
					accentColor: "  #5B7FFF  ",
					properties: [
						row({
							id: "released-on",
							key: " releasedOn ",
							type: "date",
							required: true,
						}),
						row({ id: "rating", key: "rating", type: "number" }),
					],
				},
				"tracker-123",
			),
		).toEqual({
			name: "Books",
			slug: "books",
			icon: "book-open",
			accentColor: "#5B7FFF",
			trackerId: "tracker-123",
			propertiesSchema: {
				fields: {
					rating: { label: "Title", type: "number" },
					releasedOn: {
						type: "date",
						label: "Title",
						validation: { required: true },
					},
				},
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
					properties: [row({ id: "title", key: "title" })],
				},
				"tracker-123",
			),
		).toEqual({
			name: "Books",
			icon: "book-open",
			accentColor: "#5B7FFF",
			trackerId: "tracker-123",
			propertiesSchema: {
				fields: { title: { label: "Title", type: "string" } },
			},
		});
	});
});
