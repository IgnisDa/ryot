import type { JsonValue } from "@ryot/contract/modules/sandbox/wire";
import type {
	AppChoice,
	AppPropertyDefinition,
	AppSchema,
	AppArrayPropertyValidation,
} from "@ryot/contract/schema/property-schema";
import {
	evaluateAppSchemaRuleCondition,
	getOrderedAppSchemaFieldEntries,
	isAppSchemaPathEffectivelyRequired,
	isAppSchemaPathHidden,
	isMissingAppSchemaRequiredValue,
} from "@ryot/contract/schema/property-schema";

export type SchemaFormArrayValue = boolean | number | string;

export type SchemaFormValue =
	| boolean
	| number
	| string
	| undefined
	| readonly SchemaFormArrayValue[];

export type SchemaFormValues = Readonly<Record<string, SchemaFormValue>>;

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
): ReadonlyMap<string, string> => {
	const input = effectiveConditionInput(schema, values);
	const { fields } = describeSchemaFormFieldsWithInput(schema, input);
	const errors = new Map<string, string>();
	for (const field of fields) {
		if (field.required && isMissingAppSchemaRequiredValue(input[field.key])) {
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
		const value = input[field.key];
		if (field.type !== "array" || !Array.isArray(value) || field.arrayItem === undefined) {
			continue;
		}
		if (
			field.arrayValidation?.minItems !== undefined &&
			value.length < field.arrayValidation.minItems
		) {
			errors.set(
				field.key,
				`${field.label} needs at least ${field.arrayValidation.minItems} items`,
			);
			continue;
		}
		if (
			field.arrayValidation?.maxItems !== undefined &&
			value.length > field.arrayValidation.maxItems
		) {
			errors.set(
				field.key,
				`${field.label} allows at most ${field.arrayValidation.maxItems} items`,
			);
			continue;
		}
		const item = field.arrayItem;
		const invalidIndex = value.findIndex((entry) => !isSchemaFormArrayValue(entry, item));
		if (invalidIndex !== -1) {
			errors.set(field.key, `${item.label} ${invalidIndex + 1} has an invalid value`);
			continue;
		}
		for (const [index, entry] of (value as readonly SchemaFormArrayValue[]).entries()) {
			if (item.type === "string") {
				if (typeof entry !== "string") {
					continue;
				}
				const validation = item.validation;
				if (validation?.required === true && entry === "") {
					errors.set(field.key, `${item.label} ${index + 1} is required`);
					break;
				}
				if (validation?.minLength !== undefined && entry.length < validation.minLength) {
					errors.set(field.key, `${item.label} ${index + 1} is too short`);
					break;
				}
				if (validation?.maxLength !== undefined && entry.length > validation.maxLength) {
					errors.set(field.key, `${item.label} ${index + 1} is too long`);
					break;
				}
				if (validation?.pattern !== undefined && !new RegExp(validation.pattern).test(entry)) {
					errors.set(field.key, `${item.label} ${index + 1} has an invalid format`);
					break;
				}
				continue;
			}
			if (item.type === "boolean") {
				continue;
			}
			if (typeof entry !== "number") {
				continue;
			}
			const validation = item.validation;
			if (validation?.minimum !== undefined && entry < validation.minimum) {
				errors.set(field.key, `${item.label} ${index + 1} is below the minimum`);
				break;
			}
			if (validation?.maximum !== undefined && entry > validation.maximum) {
				errors.set(field.key, `${item.label} ${index + 1} is above the maximum`);
				break;
			}
			if (validation?.exclusiveMinimum !== undefined && entry <= validation.exclusiveMinimum) {
				errors.set(field.key, `${item.label} ${index + 1} must be above the minimum`);
				break;
			}
			if (validation?.exclusiveMaximum !== undefined && entry >= validation.exclusiveMaximum) {
				errors.set(field.key, `${item.label} ${index + 1} must be below the maximum`);
				break;
			}
			if (validation?.multipleOf !== undefined && entry % validation.multipleOf !== 0) {
				errors.set(field.key, `${item.label} ${index + 1} is not a valid increment`);
				break;
			}
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
		if (!isSupportedProperty(property) || !Object.hasOwn(input, key)) {
			continue;
		}
		if (isFixedEnumProperty(property)) {
			payload[key] = property.defaultValue;
			continue;
		}
		const value = values[key];
		if (!renderedKeys.has(key) || !hasSchemaFormValue(value)) {
			continue;
		}
		payload[key] = Array.isArray(value) ? [...value] : value;
	}
	return payload;
};
