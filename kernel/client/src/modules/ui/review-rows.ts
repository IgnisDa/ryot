import {
	describeSchemaFormFields,
	schemaChoiceLabel,
	type SchemaFormField,
	type SchemaFormValue,
	type SchemaFormValues,
} from "@ryot-app/client-ui-sdk/schema-form";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

export type SchemaReviewRow = { readonly label: string; readonly value: string };

const MASKED_REVIEW_VALUE = "Kept hidden";

const UPLOADED_REVIEW_VALUE = "Ready to import";

const choiceLabel = (field: SchemaFormField, value: string) => {
	const choice = field.choices?.find((candidate) => candidate.value === value);
	return choice === undefined ? value : schemaChoiceLabel(choice);
};

const reviewValue = (field: SchemaFormField, value: Exclude<SchemaFormValue, undefined>) => {
	if (field.control === "file") {
		return UPLOADED_REVIEW_VALUE;
	}
	if (field.secret) {
		return MASKED_REVIEW_VALUE;
	}
	if (typeof value === "boolean") {
		return value ? "Yes" : "No";
	}
	if (typeof value === "object") {
		return value
			.map((entry) => (typeof entry === "string" ? choiceLabel(field, entry) : String(entry)))
			.join(", ");
	}
	return typeof value === "string" ? choiceLabel(field, value) : String(value);
};

export const schemaReviewRows = (
	schema: AppSchema,
	values: SchemaFormValues,
): readonly SchemaReviewRow[] =>
	describeSchemaFormFields(schema, values).fields.flatMap((field) => {
		const value = values[field.key];
		if (value === undefined || value === "" || (typeof value === "object" && value.length === 0)) {
			return [];
		}
		return [{ label: field.label, value: reviewValue(field, value) }];
	});
