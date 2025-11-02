import { describe, expect, it } from "bun:test";
import {
	buildDefaultPropertySchemaRow,
	buildPropertiesSchema,
	buildPropertySchemaFormValues,
	createPropertySchemaFormSchema,
	isPropertySchemaRowsValid,
} from "./form";

describe("buildDefaultPropertySchemaRow", () => {
	it("returns an empty optional string property row", () => {
		const row = buildDefaultPropertySchemaRow();

		expect(row).toMatchObject({
			key: "",
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

		if (!row) throw new Error("Expected a default property row");

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
				{ key: "rating", type: "number", required: false },
				{ key: " rating ", type: "integer", required: true },
			]),
		).toBeFalse();
	});

	it("accepts unique non-empty trimmed keys", () => {
		expect(
			isPropertySchemaRowsValid([
				{ key: " rating ", type: "number", required: false },
				{ key: "occurredOn", type: "date", required: true },
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
				{ id: "rating", key: "rating", type: "number", required: false },
				{ id: "score", key: " rating ", type: "integer", required: true },
			],
		});

		expect(result.success).toBeFalse();
	});
});

describe("buildPropertiesSchema", () => {
	it("trims keys and only includes required when true", () => {
		expect(
			buildPropertiesSchema([
				{ key: " occurredOn ", type: "date", required: true },
				{ key: "notes", type: "string", required: false },
			]),
		).toEqual({
			occurredOn: { type: "date", required: true },
			notes: { type: "string" },
		});
	});
});
