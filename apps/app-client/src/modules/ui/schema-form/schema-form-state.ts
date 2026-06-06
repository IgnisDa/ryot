import type { JsonValue } from "@ryot/contract/modules/sandbox/wire";
import type {
	AppChoice,
	AppPropertyDefinition,
	AppSchema,
} from "@ryot/contract/schema/property-schema";
import {
	evaluateAppSchemaRuleCondition,
	getOrderedAppSchemaFieldEntries,
	isAppSchemaPathEffectivelyRequired,
	isAppSchemaPathHidden,
	isMissingAppSchemaRequiredValue,
} from "@ryot/contract/schema/property-schema";

export type SchemaFormValue = boolean | number | string | readonly string[] | undefined;

export type SchemaFormValues = Readonly<Record<string, SchemaFormValue>>;

export type SchemaFormTextFormat = "url" | "email";

export type SchemaFormControl = "text" | "file" | "chips" | "switch" | "segmented" | "multi-select";

type SchemaFormFieldType =
	| "date"
	| "enum"
	| "number"
	| "string"
	| "boolean"
	| "integer"
	| "datetime"
	| "enum-array";

export type SchemaFormField = {
	readonly key: string;
	readonly label: string;
	readonly secret: boolean;
	readonly required: boolean;
	readonly description: string;
	readonly type: SchemaFormFieldType;
	readonly control: SchemaFormControl;
	readonly format: SchemaFormTextFormat | undefined;
	readonly choices: readonly AppChoice[] | undefined;
	readonly allowedFileExtensions: readonly string[] | undefined;
};

type SchemaFormFieldsDescription = {
	readonly unsupported: readonly string[];
	readonly fields: readonly SchemaFormField[];
};

const SEGMENTED_LABEL_LIMIT = 12;

const SEGMENTED_CHOICE_LIMIT = 3;

export const schemaChoiceLabel = (choice: AppChoice) => choice.label ?? choice.value;

const schemaFieldType = (property: AppPropertyDefinition): SchemaFormFieldType | undefined =>
	property.type === "array" || property.type === "object" ? undefined : property.type;

const schemaFieldChoices = (property: AppPropertyDefinition) => {
	if (property.type !== "enum" && property.type !== "enum-array") {
		return undefined;
	}
	return property.choices.kind === "static" ? property.choices.values : undefined;
};

const schemaFieldFormat = (property: AppPropertyDefinition): SchemaFormTextFormat | undefined =>
	property.type === "string" && property.format !== undefined && property.format.kind !== "upload"
		? property.format.kind
		: undefined;

const hasDynamicChoices = (property: AppPropertyDefinition) =>
	(property.type === "enum" || property.type === "enum-array") &&
	property.choices.kind === "dynamic";

const isUploadProperty = (property: AppPropertyDefinition) =>
	property.type === "string" && property.format?.kind === "upload";

const schemaFieldFileExtensions = (property: AppPropertyDefinition) =>
	property.type === "string" && property.format?.kind === "upload"
		? property.format.allowedFileExtensions
		: undefined;

const isSupportedProperty = (property: AppPropertyDefinition) =>
	schemaFieldType(property) !== undefined && !hasDynamicChoices(property);

const schemaFieldControl = (
	property: AppPropertyDefinition,
	choices: readonly AppChoice[] | undefined,
): SchemaFormControl => {
	if (property.type === "boolean") {
		return "switch";
	}
	if (isUploadProperty(property)) {
		return "file";
	}
	if (property.type === "enum-array") {
		return "multi-select";
	}
	if (property.type !== "enum" || choices === undefined) {
		return "text";
	}
	const fitsSegments =
		choices.length > 1 &&
		choices.length <= SEGMENTED_CHOICE_LIMIT &&
		choices.every((choice) => schemaChoiceLabel(choice).length <= SEGMENTED_LABEL_LIMIT);
	return fitsSegments ? "segmented" : "chips";
};

const hasSchemaFormValue = (value: SchemaFormValue): value is Exclude<SchemaFormValue, undefined> =>
	value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0);

const effectiveConditionInput = (schema: AppSchema, values: SchemaFormValues) => {
	const entries = getOrderedAppSchemaFieldEntries(schema.fields);
	const supportedEntries = entries.filter(([, property]) => isSupportedProperty(property));
	let input: Readonly<Record<string, unknown>> = Object.fromEntries(
		entries.flatMap(([key, property]) => {
			const value = hasSchemaFormValue(values[key]) ? values[key] : property.defaultValue;
			return value === undefined ? [] : [[key, value]];
		}),
	);
	for (let pass = 0; pass < supportedEntries.length; pass++) {
		const hidden = new Set(
			supportedEntries.flatMap(([key]) =>
				Object.hasOwn(input, key) && isAppSchemaPathHidden(schema, [key], input) ? [key] : [],
			),
		);
		if (hidden.size === 0) {
			break;
		}
		input = Object.fromEntries(Object.entries(input).filter(([key]) => !hidden.has(key)));
	}
	return input;
};

const describeSchemaFormFieldsWithInput = (
	schema: AppSchema,
	input: Readonly<Record<string, unknown>>,
): SchemaFormFieldsDescription => {
	const fields: SchemaFormField[] = [];
	const unsupported: string[] = [];
	for (const [key, property] of getOrderedAppSchemaFieldEntries(schema.fields)) {
		if (isAppSchemaPathHidden(schema, [key], input)) {
			continue;
		}
		const type = schemaFieldType(property);
		if (type === undefined || !isSupportedProperty(property)) {
			unsupported.push(key);
			continue;
		}
		const choices = schemaFieldChoices(property);
		fields.push({
			key,
			type,
			choices,
			label: property.label,
			secret: property.secret === true,
			description: property.description,
			format: schemaFieldFormat(property),
			control: schemaFieldControl(property, choices),
			allowedFileExtensions: schemaFieldFileExtensions(property),
			required: isAppSchemaPathEffectivelyRequired(schema, [key], input),
		});
	}
	return { fields, unsupported };
};

export const describeSchemaFormFields = (
	schema: AppSchema,
	values: SchemaFormValues = {},
): SchemaFormFieldsDescription =>
	describeSchemaFormFieldsWithInput(schema, effectiveConditionInput(schema, values));

const schemaFieldDefaultValue = (property: AppPropertyDefinition): SchemaFormValue =>
	property.type === "array" || property.type === "object" ? undefined : property.defaultValue;

export const initialSchemaFormValues = (schema: AppSchema): SchemaFormValues =>
	Object.fromEntries(
		getOrderedAppSchemaFieldEntries(schema.fields).flatMap(([key, property]) =>
			isSupportedProperty(property) ? [[key, schemaFieldDefaultValue(property)]] : [],
		),
	);

export const validateSchemaFormValues = (
	schema: AppSchema,
	values: SchemaFormValues,
): ReadonlyMap<string, string> => {
	const input = effectiveConditionInput(schema, values);
	const { fields } = describeSchemaFormFieldsWithInput(schema, input);
	const errors = new Map<string, string>();
	for (const field of fields) {
		if (!field.required || !isMissingAppSchemaRequiredValue(input[field.key])) {
			continue;
		}
		const conditionalMessage = (schema.rules ?? []).find(
			(rule) =>
				rule.kind === "validation" &&
				rule.path.length === 1 &&
				rule.path[0] === field.key &&
				evaluateAppSchemaRuleCondition(rule.when, input),
		)?.message;
		errors.set(field.key, conditionalMessage ?? `${field.label} is required`);
	}
	return errors;
};

export const toSchemaFormPayload = (
	schema: AppSchema,
	values: SchemaFormValues,
): Record<string, JsonValue> => {
	const input = effectiveConditionInput(schema, values);
	const payload: Record<string, JsonValue> = {};
	for (const field of describeSchemaFormFieldsWithInput(schema, input).fields) {
		const value = values[field.key];
		if (!Object.hasOwn(input, field.key) || !hasSchemaFormValue(value)) {
			continue;
		}
		payload[field.key] = Array.isArray(value) ? [...value] : value;
	}
	return payload;
};
