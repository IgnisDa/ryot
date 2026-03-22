import { describe, expect, it } from "bun:test";
import {
	createPropertySchemaInputFixture,
	createPropertySchemaRowFixture,
} from "#/features/test-fixtures";
import { resolveNextPropertySchemaSlug } from "../property-schemas/form";
import {
	buildDefaultEventSchemaPropertyRow,
	buildEventSchemaFormValues,
	buildEventSchemaPropertiesSchema,
	createEventSchemaFormSchema,
	defaultCreateEventSchemaFormValues,
	isEventSchemaPropertyRowsValid,
	toCreateEventSchemaPayload,
} from "./form";

const input = createPropertySchemaInputFixture;
const row = createPropertySchemaRowFixture;

describe("buildDefaultEventSchemaPropertyRow", () => {
	it("returns an empty optional string property row", () => {
		const row = buildDefaultEventSchemaPropertyRow();

		expect(row).toMatchObject({
			key: "",
			type: "string",
			required: false,
		});
		expect(row.id).toEqual(expect.any(String));
	});
});

describe("buildEventSchemaFormValues", () => {
	it("returns default values with one property row", () => {
		const values = buildEventSchemaFormValues();
		const row = values.properties[0];

		if (!row) {
			throw new Error("Expected a default property row");
		}

		expect(values.name).toBe("");
		expect(values.slug).toBe("");
		expect(values.properties).toHaveLength(1);
		expect(row).toMatchObject({
			key: "",
			type: "string",
			required: false,
		});
		expect(row.id).toEqual(expect.any(String));
	});

	it("exports the default create values", () => {
		const row = defaultCreateEventSchemaFormValues.properties[0];

		if (!row) {
			throw new Error("Expected an exported default property row");
		}

		expect(defaultCreateEventSchemaFormValues.name).toBe("");
		expect(defaultCreateEventSchemaFormValues.slug).toBe("");
		expect(defaultCreateEventSchemaFormValues.properties).toHaveLength(1);
		expect(row).toMatchObject({
			key: "",
			type: "string",
			required: false,
		});
		expect(row.id).toEqual(expect.any(String));
	});

	it("maps existing values into form defaults", () => {
		const properties = [
			input({ key: "rating", type: "number", required: true }),
		];
		const inputRow = properties[0];

		if (!inputRow) {
			throw new Error("Expected an input property row");
		}

		const values = buildEventSchemaFormValues({
			properties,
			name: "Tasting",
			slug: "tasting",
		});
		const row = values.properties[0];

		if (!row) {
			throw new Error("Expected a mapped property row");
		}

		expect(values.name).toBe("Tasting");
		expect(values.slug).toBe("tasting");
		expect(values.properties).toHaveLength(1);
		expect(row).toMatchObject(inputRow);
		expect(row.id).toEqual(expect.any(String));
	});

	it("normalizes an empty properties array to one default row", () => {
		const values = buildEventSchemaFormValues({ properties: [] });
		const row = values.properties[0];

		if (!row) {
			throw new Error("Expected a normalized property row");
		}

		expect(values.properties).toHaveLength(1);
		expect(row).toMatchObject({
			key: "",
			type: "string",
			required: false,
		});
		expect(row.id).toEqual(expect.any(String));
	});
});

describe("resolveNextPropertySchemaSlug", () => {
	it("preserves a customized slug", () => {
		expect(
			resolveNextPropertySchemaSlug({
				name: "Tasting Mood",
				slug: "house-special",
				previousDerivedSlug: "tasting-mood",
			}),
		).toBe("house-special");
	});

	it("clears the slug when the name is cleared and it was still auto-derived", () => {
		expect(
			resolveNextPropertySchemaSlug({
				name: "   ",
				slug: "tasting-mood",
				previousDerivedSlug: "tasting-mood",
			}),
		).toBe("");
	});

	it("keeps auto-updating when the previous derived slug only differs by whitespace", () => {
		expect(
			resolveNextPropertySchemaSlug({
				name: "Tasting Mood",
				slug: "tasting-mood ",
				previousDerivedSlug: "tasting-mood",
			}),
		).toBe("tasting-mood");
	});
});

describe("isEventSchemaPropertyRowsValid", () => {
	it("returns false when there are no property rows", () => {
		expect(isEventSchemaPropertyRowsValid([])).toBeFalse();
	});

	it("returns false when a trimmed key is empty", () => {
		expect(
			isEventSchemaPropertyRowsValid([buildDefaultEventSchemaPropertyRow()]),
		).toBeFalse();
	});

	it("returns false when trimmed keys are duplicated", () => {
		expect(
			isEventSchemaPropertyRowsValid([
				input({ key: "rating", type: "number" }),
				input({ key: " rating ", type: "integer", required: true }),
			]),
		).toBeFalse();
	});

	it("returns true for unique non-empty trimmed keys", () => {
		expect(
			isEventSchemaPropertyRowsValid([
				input({ key: " rating ", type: "number" }),
				input({ key: "occurredOn", type: "date", required: true }),
			]),
		).toBeTrue();
	});
});

describe("createEventSchemaFormSchema", () => {
	it("rejects a whitespace-only name but allows a blank slug", () => {
		const result = createEventSchemaFormSchema.safeParse({
			name: "  \n\t ",
			slug: "  \n\t ",
			properties: [row({ id: "rating", key: "rating", type: "number" })],
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
		const result = createEventSchemaFormSchema.safeParse({
			name: "Tasting",
			slug: "  \n\t ",
			properties: [row({ id: "rating", key: "rating", type: "number" })],
		});

		expect(result.success).toBeTrue();
	});

	it("rejects empty property rows", () => {
		const result = createEventSchemaFormSchema.safeParse({
			properties: [],
			name: "Tasting",
			slug: "tasting",
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
			row({ id: "rating", key: "rating", type: "number" }),
			row({ id: "score", key: " rating ", type: "integer", required: true }),
		] as const;
		const result = createEventSchemaFormSchema.safeParse({
			properties,
			name: "Tasting",
			slug: "tasting",
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
		const properties = [
			row({ id: "rating", key: " \n\t ", type: "number" }),
		] as const;
		const result = createEventSchemaFormSchema.safeParse({
			properties,
			name: "Tasting",
			slug: "tasting",
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

	it("accepts valid values", () => {
		const result = createEventSchemaFormSchema.safeParse({
			name: "Tasting",
			slug: "tasting",
			properties: [
				row({ id: "rating", key: "rating", type: "number", required: true }),
				row({ id: "occurred-on", key: "occurredOn", type: "date" }),
			],
		});

		expect(result.success).toBeTrue();
	});
});

describe("buildEventSchemaPropertiesSchema", () => {
	it("maps scalar property types and trims keys", () => {
		expect(
			buildEventSchemaPropertiesSchema([
				input({ key: "notes" }),
				input({ key: " rating ", type: "number" }),
				input({ key: "isFavorite", type: "boolean" }),
			]),
		).toEqual({
			notes: { type: "string" },
			rating: { type: "number" },
			isFavorite: { type: "boolean" },
		});
	});

	it("maps integer type correctly", () => {
		expect(
			buildEventSchemaPropertiesSchema([
				input({ key: "score", type: "integer" }),
			]),
		).toEqual({ score: { type: "integer" } });
	});

	it("maps date rows and includes required flag when present", () => {
		expect(
			buildEventSchemaPropertiesSchema([
				input({ key: "occurredOn", type: "date", required: true }),
				input({ key: "notes" }),
			]),
		).toEqual({
			notes: { type: "string" },
			occurredOn: { type: "date", required: true },
		});
	});
});

describe("toCreateEventSchemaPayload", () => {
	it("omits slug when the input is blank", () => {
		expect(
			toCreateEventSchemaPayload(
				{
					name: "  Tasting  ",
					slug: "  \n\t ",
					properties: [row({ id: "rating", key: "rating", type: "number" })],
				},
				"entity-schema-123",
			),
		).toEqual({
			name: "Tasting",
			entitySchemaId: "entity-schema-123",
			propertiesSchema: { rating: { type: "number" } },
		});
	});

	it("trims name and slug, includes entitySchemaId, and serializes property rows", () => {
		expect(
			toCreateEventSchemaPayload(
				{
					slug: " tasting ",
					name: "  Tasting  ",
					properties: [
						row({
							id: "occurred-on",
							key: " occurredOn ",
							type: "date",
							required: true,
						}),
						row({ id: "rating", key: "rating", type: "number" }),
					],
				},
				"entity-schema-123",
			),
		).toEqual({
			name: "Tasting",
			slug: "tasting",
			entitySchemaId: "entity-schema-123",
			propertiesSchema: {
				occurredOn: { type: "date", required: true },
				rating: { type: "number" },
			},
		});
	});
});
