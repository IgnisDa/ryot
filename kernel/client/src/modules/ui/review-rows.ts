import {
	type AppPropertyDefinition,
	type AppSchema,
	getOrderedAppSchemaFieldEntries,
} from "@ryot-app/contract/schema/property-schema";
import {
	schemaChoiceLabel,
	type SchemaFormValues,
	toSchemaFormPayload,
} from "@ryot-app/plugin-ui-sdk/schema-form";

export type SchemaReviewRow = { readonly label: string; readonly value: string };

const choiceLabel = (property: AppPropertyDefinition, value: string) => {
	if (
		(property.type !== "enum" && property.type !== "enum-array") ||
		property.choices.kind !== "static"
	) {
		return value;
	}
	const choice = property.choices.values.find((candidate) => candidate.value === value);
	return choice === undefined ? value : schemaChoiceLabel(choice);
};

const primitiveValue = (property: AppPropertyDefinition, value: unknown) => {
	if (typeof value === "boolean") {
		return value ? "Yes" : "No";
	}
	if (typeof value === "string") {
		return choiceLabel(property, value);
	}
	return typeof value === "number" ? String(value) : "";
};

const reviewPropertyRows = (
	property: AppPropertyDefinition,
	value: unknown,
	label: string,
): readonly SchemaReviewRow[] => {
	if (value === undefined) {
		return [];
	}
	if (property.secret) {
		return [{ label, value: "Kept hidden" }];
	}
	if (property.type === "string" && property.format?.kind === "upload") {
		return [{ label, value: "Ready to import" }];
	}
	if (property.type === "string" && property.format?.kind === "oauth-connection") {
		return [{ label, value: value === null ? "Not set" : "Connected" }];
	}
	if (value === null) {
		return [{ label, value: "Not set" }];
	}
	if (property.type === "object" && property.validation?.asset) {
		return [{ label, value: "Attached" }];
	}
	if (property.type === "object" && typeof value === "object" && !Array.isArray(value)) {
		return getOrderedAppSchemaFieldEntries(property.properties).flatMap(([key, child]) =>
			reviewPropertyRows(child, Reflect.get(value, key), `${label} / ${child.label}`),
		);
	}
	if (property.type === "array" && Array.isArray(value)) {
		return value.flatMap((item, index) =>
			reviewPropertyRows(property.items, item, `${label} ${index + 1}`),
		);
	}
	if (Array.isArray(value)) {
		return [{ label, value: value.map((item) => primitiveValue(property, item)).join(", ") }];
	}
	return [{ label, value: primitiveValue(property, value) }];
};

export const schemaReviewRows = (
	schema: AppSchema,
	values: SchemaFormValues,
): readonly SchemaReviewRow[] => {
	const input = toSchemaFormPayload(schema, values);
	return getOrderedAppSchemaFieldEntries(schema.fields).flatMap(([key, property]) =>
		reviewPropertyRows(property, input[key], property.label),
	);
};
