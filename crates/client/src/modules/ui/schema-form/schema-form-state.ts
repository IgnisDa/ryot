import type { JsonValue } from "@ryot-app/contract/modules/sandbox/wire";
import {
	type AppChoice,
	type AppPropertyDefinition,
	type AppSchema,
	type AppArrayPropertyValidation,
	evaluateAppSchemaRuleCondition,
	getOrderedAppSchemaFieldEntries,
	isAppSchemaPathEffectivelyRequired,
	isAppSchemaPathHidden,
	isMissingAppSchemaRequiredValue,
} from "@ryot-app/contract/schema/property-schema";
import { Email, HttpUrl } from "@ryot-app/contract/schema/utils";
import { Match, Result, Schema } from "effect";

export type SchemaFormArrayValue = boolean | number | string;

export type SchemaFormValue =
	| boolean
	| number
	| string
	| undefined
	| readonly SchemaFormArrayValue[];

export type SchemaFormValues = Readonly<Record<string, SchemaFormValue>>;

export type SchemaFormMode = "edit" | "create";

export type SchemaFormTextFormat = "url" | "email";

export type SchemaFormControl =
	| "list"
	| "text"
	| "file"
	| "chips"
	| "switch"
	| "segmented"
	| "multi-select";

export type SchemaFormArrayItem = Extract<
	AppPropertyDefinition,
	{ readonly type: "string" | "number" | "integer" | "boolean" }
>;

type SchemaFormFieldType =
	| "date"
	| "enum"
	| "array"
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
	readonly arrayItem: SchemaFormArrayItem | undefined;
	readonly allowedFileExtensions: readonly string[] | undefined;
	readonly arrayValidation: AppArrayPropertyValidation | undefined;
};

type SchemaFormFieldsDescription = {
	readonly unsupported: readonly string[];
	readonly fields: readonly SchemaFormField[];
};

const SEGMENTED_LABEL_LIMIT = 12;

const SEGMENTED_CHOICE_LIMIT = 3;

export const schemaChoiceLabel = (choice: AppChoice) => choice.label ?? choice.value;

const schemaArrayItem = (property: AppPropertyDefinition): SchemaFormArrayItem | undefined => {
	if (property.type !== "array") {
		return undefined;
	}
	const item = property.items;
	return item.type === "string" ||
		item.type === "number" ||
		item.type === "integer" ||
		item.type === "boolean"
		? item
		: undefined;
};

const schemaFieldType = (property: AppPropertyDefinition): SchemaFormFieldType | undefined => {
	if (property.type === "array") {
		return schemaArrayItem(property) === undefined ? undefined : "array";
	}
	return property.type === "object" ? undefined : property.type;
};

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

const isFixedEnumProperty = (
	property: AppPropertyDefinition,
): property is Extract<AppPropertyDefinition, { readonly type: "enum" }> & {
	readonly defaultValue: string;
} =>
	property.type === "enum" &&
	property.defaultValue !== undefined &&
	property.choices.kind === "static" &&
	property.choices.values.length === 1;

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
	if (property.type === "array") {
		return "list";
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

const isMissingSchemaFormValue = (value: unknown) =>
	isMissingAppSchemaRequiredValue(value) || (Array.isArray(value) && value.length === 0);

/**
 * Condition input deliberately treats an emptied list as absent, so `exists` rules stay false.
 * Validation still has to see the list the user actually holds, otherwise a field carrying a
 * non-empty `defaultValue` would be checked against that default instead of the cleared value.
 */
const validatedFieldValue = (
	field: SchemaFormField,
	values: SchemaFormValues,
	input: Readonly<Record<string, unknown>>,
) =>
	field.type === "array" && Array.isArray(values[field.key]) ? values[field.key] : input[field.key];

/**
 * Redaction strips stored secrets before they reach the client, so an edit form cannot tell
 * "never set" from "set and hidden". Leaving a secret blank therefore means "keep the current
 * value": the key is omitted from the payload and the server merges the stored one back in.
 */
export const isRetainedSecretField = (field: SchemaFormField, mode: SchemaFormMode) =>
	mode === "edit" && field.secret;

const effectiveConditionInput = (schema: AppSchema, values: SchemaFormValues) => {
	const entries = getOrderedAppSchemaFieldEntries(schema.fields);
	const supportedEntries = entries.filter(([, property]) => isSupportedProperty(property));
	let input: Readonly<Record<string, unknown>> = Object.fromEntries(
		entries.flatMap(([key, property]) => {
			let value = property.defaultValue;
			if (!isFixedEnumProperty(property) && hasSchemaFormValue(values[key])) {
				value = values[key];
			}
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
		if (isFixedEnumProperty(property)) {
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
			arrayItem: schemaArrayItem(property),
			control: schemaFieldControl(property, choices),
			allowedFileExtensions: schemaFieldFileExtensions(property),
			required: isAppSchemaPathEffectivelyRequired(schema, [key], input),
			arrayValidation: property.type === "array" ? property.validation : undefined,
		});
	}
	return { fields, unsupported };
};

export const describeSchemaFormFields = (
	schema: AppSchema,
	values: SchemaFormValues = {},
): SchemaFormFieldsDescription =>
	describeSchemaFormFieldsWithInput(schema, effectiveConditionInput(schema, values));

const isSchemaFormArrayValue = (
	value: unknown,
	item: SchemaFormArrayItem,
): value is SchemaFormArrayValue => {
	if (item.type === "boolean") {
		return typeof value === "boolean";
	}
	if (item.type === "string") {
		return typeof value === "string";
	}
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		(item.type !== "integer" || Number.isInteger(value))
	);
};

const stringValidationMessage = (
	property: Extract<AppPropertyDefinition, { readonly type: "string" }>,
	value: unknown,
	label: string,
) => {
	if (typeof value !== "string") {
		return `${label} has an invalid value`;
	}
	const validation = property.validation;
	if (validation?.required === true && value === "") {
		return `${label} is required`;
	}
	if (validation?.minLength !== undefined && value.length < validation.minLength) {
		return `${label} is too short`;
	}
	if (validation?.maxLength !== undefined && value.length > validation.maxLength) {
		return `${label} is too long`;
	}
	if (validation?.pattern !== undefined && !new RegExp(validation.pattern).test(value)) {
		return `${label} has an invalid format`;
	}
	if (
		property.format?.kind === "url" &&
		Result.isFailure(Schema.decodeUnknownResult(HttpUrl)(value))
	) {
		return `${label} has an invalid format`;
	}
	if (
		property.format?.kind === "email" &&
		Result.isFailure(Schema.decodeUnknownResult(Email)(value))
	) {
		return `${label} has an invalid format`;
	}
	return undefined;
};

const numberValidationMessage = (
	property: Extract<AppPropertyDefinition, { readonly type: "number" | "integer" }>,
	value: unknown,
	label: string,
) => {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		(property.type === "integer" && !Number.isInteger(value))
	) {
		return `${label} has an invalid value`;
	}
	const validation = property.validation;
	if (validation?.minimum !== undefined && value < validation.minimum) {
		return `${label} is below the minimum`;
	}
	if (validation?.maximum !== undefined && value > validation.maximum) {
		return `${label} is above the maximum`;
	}
	if (validation?.exclusiveMinimum !== undefined && value <= validation.exclusiveMinimum) {
		return `${label} must be above the minimum`;
	}
	if (validation?.exclusiveMaximum !== undefined && value >= validation.exclusiveMaximum) {
		return `${label} must be below the maximum`;
	}
	if (validation?.multipleOf !== undefined && value % validation.multipleOf !== 0) {
		return `${label} is not a valid increment`;
	}
	return undefined;
};

const arrayBoundsValidationMessage = (
	property: Extract<AppPropertyDefinition, { readonly type: "array" | "enum-array" }>,
	value: readonly unknown[],
	label: string,
) => {
	if (property.validation?.minItems !== undefined && value.length < property.validation.minItems) {
		return `${label} needs at least ${property.validation.minItems} items`;
	}
	if (property.validation?.maxItems !== undefined && value.length > property.validation.maxItems) {
		return `${label} allows at most ${property.validation.maxItems} items`;
	}
	return undefined;
};

const propertyValueValidationMessage = (
	property: AppPropertyDefinition,
	value: unknown,
	label: string,
): string | undefined =>
	Match.value(property).pipe(
		Match.when({ type: "string" }, (matched) => stringValidationMessage(matched, value, label)),
		Match.when({ type: "number" }, (matched) => numberValidationMessage(matched, value, label)),
		Match.when({ type: "integer" }, (matched) => numberValidationMessage(matched, value, label)),
		Match.when({ type: "boolean" }, () =>
			typeof value === "boolean" ? undefined : `${label} has an invalid value`,
		),
		Match.when({ type: "date" }, () =>
			typeof value === "string" &&
			Result.isSuccess(Schema.decodeUnknownResult(Schema.DateFromString)(value))
				? undefined
				: `${label} has an invalid format`,
		),
		Match.when({ type: "datetime" }, () =>
			typeof value === "string" &&
			Result.isSuccess(Schema.decodeUnknownResult(Schema.DateTimeUtcFromString)(value))
				? undefined
				: `${label} has an invalid format`,
		),
		Match.when({ type: "enum" }, (matched) =>
			typeof value === "string" &&
			matched.choices.kind === "static" &&
			matched.choices.values.some((choice) => choice.value === value)
				? undefined
				: `${label} has an invalid value`,
		),
		Match.when({ type: "enum-array" }, (matched) => {
			if (!Array.isArray(value) || matched.choices.kind !== "static") {
				return `${label} has an invalid value`;
			}
			const boundsMessage = arrayBoundsValidationMessage(matched, value, label);
			if (boundsMessage !== undefined) {
				return boundsMessage;
			}
			return value.every(
				(item) =>
					typeof item === "string" &&
					matched.choices.kind === "static" &&
					matched.choices.values.some((choice) => choice.value === item),
			)
				? undefined
				: `${label} has an invalid value`;
		}),
		Match.when({ type: "array" }, (matched) => {
			if (!Array.isArray(value)) {
				return `${label} has an invalid value`;
			}
			const boundsMessage = arrayBoundsValidationMessage(matched, value, label);
			if (boundsMessage !== undefined) {
				return boundsMessage;
			}
			for (const [index, item] of value.entries()) {
				const message = propertyValueValidationMessage(
					matched.items,
					item,
					`${matched.items.label} ${index + 1}`,
				);
				if (message !== undefined) {
					return message;
				}
			}
			return undefined;
		}),
		Match.when({ type: "object" }, () => `${label} has an invalid value`),
		Match.exhaustive,
	);

const schemaFieldDefaultValue = (property: AppPropertyDefinition): SchemaFormValue => {
	if (property.type === "object") {
		return undefined;
	}
	if (property.type !== "array") {
		return property.defaultValue;
	}
	const item = schemaArrayItem(property);
	return item !== undefined &&
		property.defaultValue?.every((value) => isSchemaFormArrayValue(value, item))
		? property.defaultValue
		: undefined;
};

export const initialSchemaFormValues = (schema: AppSchema): SchemaFormValues =>
	Object.fromEntries(
		getOrderedAppSchemaFieldEntries(schema.fields).flatMap(([key, property]) =>
			isSupportedProperty(property) ? [[key, schemaFieldDefaultValue(property)]] : [],
		),
	);

export const validateSchemaFormValues = (
	schema: AppSchema,
	values: SchemaFormValues,
	mode: SchemaFormMode = "create",
): ReadonlyMap<string, string> => {
	const input = effectiveConditionInput(schema, values);
	const { fields } = describeSchemaFormFieldsWithInput(schema, input);
	const errors = new Map<string, string>();
	for (const field of fields) {
		const fieldValue = validatedFieldValue(field, values, input);
		if (field.required && isMissingSchemaFormValue(fieldValue)) {
			if (isRetainedSecretField(field, mode)) {
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
			continue;
		}
		if (fieldValue === undefined) {
			continue;
		}
		const validationMessage = propertyValueValidationMessage(
			schema.fields[field.key],
			fieldValue,
			field.label,
		);
		if (validationMessage !== undefined) {
			errors.set(field.key, validationMessage);
		}
	}
	return errors;
};

export const toSchemaFormPayload = (
	schema: AppSchema,
	values: SchemaFormValues,
): Record<string, JsonValue> => {
	const input = effectiveConditionInput(schema, values);
	const payload: Record<string, JsonValue> = {};
	const renderedKeys = new Set(
		describeSchemaFormFieldsWithInput(schema, input).fields.map((field) => field.key),
	);
	for (const [key, property] of getOrderedAppSchemaFieldEntries(schema.fields)) {
		if (!isSupportedProperty(property)) {
			continue;
		}
		if (isFixedEnumProperty(property)) {
			if (Object.hasOwn(input, key)) {
				payload[key] = property.defaultValue;
			}
			continue;
		}
		if (!renderedKeys.has(key)) {
			continue;
		}
		const value = values[key];
		// An emptied list is a real edit, so it has to reach the server for a stored list to clear.
		if (Array.isArray(value)) {
			payload[key] = [...value];
			continue;
		}
		if (hasSchemaFormValue(value)) {
			payload[key] = value;
		}
	}
	return payload;
};
