import { describe, expect, it } from "bun:test";
import {
	createPropertySchemaInputFixture,
	createPropertySchemaRowFixture,
} from "~/features/test-fixtures";
import {
	buildDefaultPropertySchemaRow,
	buildPropertiesSchema,
	buildPropertySchemaFormValues,
	createPropertySchemaFormSchema,
	isPropertySchemaRowsValid,
	resolveNextPropertySchemaSlug,
} from "./form";

const input = createPropertySchemaInputFixture;
const row = createPropertySchemaRowFixture;

describe("buildDefaultPropertySchemaRow", () => {
	it("returns an empty optional string property row", () => {
		const row = buildDefaultPropertySchemaRow();

		expect(row).toMatchObject({
			key: "",
			label: "",
			type: "string",
			required: false,
		});
		expect(row.id).toEqual(expect.any(String));
	});
});

describe("buildPropertySchemaFormValues", () => {
	it("returns one default property row when properties are missing", () => {
		const values = buildPropertySchemaFormValues();
		const row = values.properties[0];

		if (!row) {
			throw new Error("Expected a default property row");
		}

		expect(values.name).toBe("");
		expect(values.slug).toBe("");
		expect(values.properties).toHaveLength(1);
		expect(row.id).toEqual(expect.any(String));
	});
});

describe("isPropertySchemaRowsValid", () => {
	it("rejects empty and duplicate trimmed keys", () => {
		expect(isPropertySchemaRowsValid([])).toBeFalse();
		expect(
			isPropertySchemaRowsValid([buildDefaultPropertySchemaRow()]),
		).toBeFalse();
		expect(
			isPropertySchemaRowsValid([
				input({ key: "rating", type: "number" }),
				input({ key: " rating ", type: "integer", required: true }),
			]),
		).toBeFalse();
	});

	it("accepts unique non-empty trimmed keys", () => {
		expect(
			isPropertySchemaRowsValid([
				input({ key: " rating ", type: "number" }),
				input({ key: "occurredOn", type: "date", required: true }),
			]),
		).toBeTrue();
	});
});

describe("createPropertySchemaFormSchema", () => {
	it("rejects duplicate trimmed property keys", () => {
		const result = createPropertySchemaFormSchema.safeParse({
			name: "Tasting",
			slug: "tasting",
			properties: [
				row({ id: "rating", key: "rating", type: "number" }),
				row({ id: "score", key: " rating ", type: "integer", required: true }),
			],
		});

		expect(result.success).toBeFalse();
	});
});

describe("buildPropertiesSchema", () => {
	it("trims keys and only includes required when true", () => {
		expect(
			buildPropertiesSchema([
				input({ key: " occurredOn ", type: "date", required: true }),
				input({ key: "notes" }),
			]),
		).toEqual({
			fields: {
				notes: { label: "Title", type: "string" },
				occurredOn: {
					type: "date",
					label: "Title",
					validation: { required: true },
				},
			},
		});
	});
});

describe("resolveNextPropertySchemaSlug", () => {
	it("preserves a non-empty slug when there is no previous derived slug", () => {
		expect(
			resolveNextPropertySchemaSlug({
				slug: "saved-schema",
				name: "Reading Status",
			}),
		).toBe("saved-schema");
	});

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

	it("treats a whitespace-only slug as blank", () => {
		expect(
			resolveNextPropertySchemaSlug({
				slug: "  \n\t ",
				name: "Reading Status",
				previousDerivedSlug: "reading-status-old",
			}),
		).toBe("reading-status");
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
