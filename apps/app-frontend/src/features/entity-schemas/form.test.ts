import { describe, expect, it } from "bun:test";
import {
	buildEntitySchemaFormValues,
	createEntitySchemaFormSchema,
	defaultCreateEntitySchemaFormValues,
	defaultEntitySchemaPropertiesSchema,
	toCreateEntitySchemaPayload,
} from "./form";

function createEntitySchemaFormValuesFixture(overrides = {}) {
	return {
		name: "Schema",
		slug: "schema",
		propertiesSchema: defaultEntitySchemaPropertiesSchema,
		...overrides,
	};
}

describe("buildEntitySchemaFormValues", () => {
	it("returns default values with the schema stub", () => {
		const values = buildEntitySchemaFormValues();

		expect(values).toEqual({
			name: "",
			slug: "",
			propertiesSchema: defaultEntitySchemaPropertiesSchema,
		});
	});

	it("exports the default create values", () => {
		expect(defaultCreateEntitySchemaFormValues).toEqual(
			buildEntitySchemaFormValues(),
		);
	});

	it("maps existing values into form defaults", () => {
		const values = buildEntitySchemaFormValues({
			name: "Custom Schema",
			slug: "custom-schema",
			propertiesSchema:
				'{"type":"object","properties":{"title":{"type":"string"}}}',
		});

		expect(values).toEqual({
			name: "Custom Schema",
			slug: "custom-schema",
			propertiesSchema:
				'{"type":"object","properties":{"title":{"type":"string"}}}',
		});
	});
});

describe("toCreateEntitySchemaPayload", () => {
	it("trims name and slug", () => {
		const payload = toCreateEntitySchemaPayload(
			createEntitySchemaFormValuesFixture({
				name: "  Custom Schema  ",
				slug: "  custom-schema  ",
			}),
			"facet-id",
		);

		expect(payload.name).toBe("Custom Schema");
		expect(payload.slug).toBe("custom-schema");
	});

	it("includes facetId", () => {
		const payload = toCreateEntitySchemaPayload(
			createEntitySchemaFormValuesFixture(),
			"facet-id",
		);

		expect(payload.facetId).toBe("facet-id");
	});

	it("preserves propertiesSchema text as entered", () => {
		const propertiesSchema =
			'  {"type":"object","properties":{"title":{"type":"string"}}}\n';

		const payload = toCreateEntitySchemaPayload(
			createEntitySchemaFormValuesFixture({ propertiesSchema }),
			"facet-id",
		);

		expect(payload.propertiesSchema).toBe(propertiesSchema);
	});
});

describe("createEntitySchemaFormSchema", () => {
	it("rejects whitespace-only required fields", () => {
		const parsed = createEntitySchemaFormSchema.safeParse({
			name: "   ",
			slug: "\n\t",
			propertiesSchema: "  ",
		});

		expect(parsed.success).toBe(false);
	});

	it("accepts valid values", () => {
		const parsed = createEntitySchemaFormSchema.safeParse({
			name: "Schema",
			slug: "schema",
			propertiesSchema: defaultEntitySchemaPropertiesSchema,
		});

		expect(parsed.success).toBe(true);
	});

	it("rejects malformed properties schema JSON", () => {
		const parsed = createEntitySchemaFormSchema.safeParse({
			name: "Schema",
			slug: "schema",
			propertiesSchema: '{"type":"object",',
		});

		expect(parsed.success).toBe(false);
	});

	it("rejects properties schema JSON that is not an object", () => {
		const parsed = createEntitySchemaFormSchema.safeParse({
			name: "Schema",
			slug: "schema",
			propertiesSchema: "[]",
		});

		expect(parsed.success).toBe(false);
	});

	it("rejects properties schema JSON with a non-object root type", () => {
		const parsed = createEntitySchemaFormSchema.safeParse({
			name: "Schema",
			slug: "schema",
			propertiesSchema: '{"type":"array","properties":{}}',
		});

		expect(parsed.success).toBe(false);
	});

	it("rejects properties schema JSON without object properties", () => {
		const missingProperties = createEntitySchemaFormSchema.safeParse({
			name: "Schema",
			slug: "schema",
			propertiesSchema: '{"type":"object"}',
		});
		const invalidProperties = createEntitySchemaFormSchema.safeParse({
			name: "Schema",
			slug: "schema",
			propertiesSchema: '{"type":"object","properties":[]}',
		});

		expect(missingProperties.success).toBe(false);
		expect(invalidProperties.success).toBe(false);
	});

	it("rejects properties schema JSON with extra top-level keys", () => {
		const parsed = createEntitySchemaFormSchema.safeParse({
			name: "Schema",
			slug: "schema",
			propertiesSchema: '{"type":"object","properties":{},"extra":true}',
		});

		expect(parsed.success).toBe(false);
	});
});
