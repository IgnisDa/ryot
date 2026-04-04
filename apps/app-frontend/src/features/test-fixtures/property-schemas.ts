import type {
	PropertySchemaInput,
	PropertySchemaRow,
} from "#/features/property-schemas/form";

export function createPropertySchemaInputFixture(
	overrides: Partial<PropertySchemaInput> = {},
): PropertySchemaInput {
	return {
		key: "title",
		type: "string",
		label: "Title",
		required: false,
		...overrides,
	};
}

export function createPropertySchemaRowFixture(
	overrides: Partial<PropertySchemaRow> = {},
): PropertySchemaRow {
	return {
		id: "property-row-1",
		...createPropertySchemaInputFixture(),
		...overrides,
	};
}
