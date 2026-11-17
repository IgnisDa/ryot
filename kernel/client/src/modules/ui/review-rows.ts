import {
	type AppPropertyDefinition,
	type AppSchema,
	getOrderedAppSchemaFieldEntries,
} from "@ryot-app/contract/schema/property-schema";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	schemaChoiceLabel,
	type SchemaFormValues,
	toSchemaFormPayload,
} from "@ryot-app/plugin-ui-sdk/schema-form";

export type SchemaReviewRow = { readonly label: string; readonly value: string };

type Translate = (message: Message) => Text;

const choiceLabel = (
	formatters: Formatters,
	t: Translate,
	property: AppPropertyDefinition,
	value: string,
) => {
	if (
		(property.type !== "enum" && property.type !== "enum-array") ||
		property.choices.kind !== "static"
	) {
		return value;
	}
	const choice = property.choices.values.find((candidate) => candidate.value === value);
	return choice === undefined ? value : schemaChoiceLabel(choice, t, formatters);
};

const primitiveValue = (
	formatters: Formatters,
	t: Translate,
	property: AppPropertyDefinition,
	value: unknown,
) => {
	if (typeof value === "boolean") {
		return t(kernelMessage(value ? "common.value.yes" : "common.value.no"));
	}
	if (typeof value === "string") {
		return choiceLabel(formatters, t, property, value);
	}
	return typeof value === "number" ? formatters.number().format(value) : "";
};

const reviewPropertyRows = (
	formatters: Formatters,
	t: Translate,
	property: AppPropertyDefinition,
	value: unknown,
	label: string,
): readonly SchemaReviewRow[] => {
	if (value === undefined) {
		return [];
	}
	if (property.secret) {
		return [{ label, value: t(kernelMessage("client.ui.review-rows.hidden")) }];
	}
	if (property.type === "string" && property.format?.kind === "upload") {
		return [{ label, value: t(kernelMessage("ui.file-field.ready-to-import")) }];
	}
	if (property.type === "string" && property.format?.kind === "oauth-connection") {
		return [
			{
				label,
				value: t(
					value === null
						? kernelMessage("client.ui.review-rows.not-set")
						: kernelMessage("client.ui.review-rows.connected"),
				),
			},
		];
	}
	if (value === null) {
		return [{ label, value: t(kernelMessage("client.ui.review-rows.not-set")) }];
	}
	if (property.type === "object" && property.validation?.asset) {
		return [{ label, value: t(kernelMessage("client.ui.review-rows.attached")) }];
	}
	if (property.type === "object" && typeof value === "object" && !Array.isArray(value)) {
		return getOrderedAppSchemaFieldEntries(property.properties).flatMap(([key, child]) =>
			reviewPropertyRows(
				formatters,
				t,
				child,
				Reflect.get(value, key),
				`${label} / ${formatDisplayText(t, child.label)}`,
			),
		);
	}
	if (property.type === "array" && Array.isArray(value)) {
		return value.flatMap((item, index) =>
			reviewPropertyRows(formatters, t, property.items, item, `${label} ${index + 1}`),
		);
	}
	if (Array.isArray(value)) {
		return [
			{
				label,
				value: formatters
					.list({ type: "unit", style: "short" })
					.format(value.map((item) => primitiveValue(formatters, t, property, item))),
			},
		];
	}
	return [{ label, value: primitiveValue(formatters, t, property, value) }];
};

export const schemaReviewRows = (
	formatters: Formatters,
	t: Translate,
	schema: AppSchema,
	values: SchemaFormValues,
): readonly SchemaReviewRow[] => {
	const input = toSchemaFormPayload(schema, values);
	return getOrderedAppSchemaFieldEntries(schema.fields).flatMap(([key, property]) =>
		reviewPropertyRows(formatters, t, property, input[key], formatDisplayText(t, property.label)),
	);
};
