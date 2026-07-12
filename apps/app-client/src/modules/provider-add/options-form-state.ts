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

export type OptionValue = boolean | number | string | readonly string[] | undefined;

export type OptionValues = Readonly<Record<string, OptionValue>>;

type OptionFieldType =
	| "date"
	| "enum"
	| "number"
	| "string"
	| "boolean"
	| "integer"
	| "datetime"
	| "enum-array";

export type OptionField = {
	readonly key: string;
	readonly label: string;
	readonly required: boolean;
	readonly description: string;
	readonly type: OptionFieldType;
	readonly choices: readonly AppChoice[] | undefined;
};

type OptionFieldsDescription = {
	readonly fields: readonly OptionField[];
	readonly unsupported: readonly string[];
};

const optionFieldType = (property: AppPropertyDefinition): OptionFieldType | undefined =>
	property.type === "array" || property.type === "object" ? undefined : property.type;

const optionFieldChoices = (property: AppPropertyDefinition) => {
	if (property.type !== "enum" && property.type !== "enum-array") {
		return undefined;
	}
	return property.choices.kind === "static" ? property.choices.values : undefined;
};

const hasOptionValue = (value: OptionValue): value is Exclude<OptionValue, undefined> =>
	value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0);

const hasDynamicChoices = (property: AppPropertyDefinition) =>
	(property.type === "enum" || property.type === "enum-array") &&
	property.choices.kind === "dynamic";

const effectiveConditionInput = (schema: AppSchema, values: OptionValues) => {
	const entries = getOrderedAppSchemaFieldEntries(schema.fields);
	const supportedEntries = entries.filter(
		([, property]) => optionFieldType(property) !== undefined && !hasDynamicChoices(property),
	);
	let input: Readonly<Record<string, unknown>> = Object.fromEntries(
		entries.flatMap(([key, property]) => {
			const value = hasOptionValue(values[key]) ? values[key] : property.defaultValue;
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

const describeOptionFieldsWithInput = (
	schema: AppSchema,
	input: Readonly<Record<string, unknown>>,
): OptionFieldsDescription => {
	const fields: OptionField[] = [];
	const unsupported: string[] = [];
	for (const [key, property] of getOrderedAppSchemaFieldEntries(schema.fields)) {
		if (isAppSchemaPathHidden(schema, [key], input)) {
			continue;
		}
		const type = optionFieldType(property);
		if (type === undefined || hasDynamicChoices(property)) {
			unsupported.push(key);
			continue;
		}
		fields.push({
			key,
			type,
			label: property.label,
			description: property.description,
			choices: optionFieldChoices(property),
			required: isAppSchemaPathEffectivelyRequired(schema, [key], input),
		});
	}
	return { fields, unsupported };
};

export const describeOptionFields = (
	schema: AppSchema,
	values: OptionValues = {},
): OptionFieldsDescription =>
	describeOptionFieldsWithInput(schema, effectiveConditionInput(schema, values));

const optionDefaultValue = (property: AppPropertyDefinition): OptionValue =>
	property.type === "array" || property.type === "object" ? undefined : property.defaultValue;

export const initialOptionValues = (schema: AppSchema): OptionValues =>
	Object.fromEntries(
		getOrderedAppSchemaFieldEntries(schema.fields).flatMap(([key, property]) => {
			const type = optionFieldType(property);
			return type === undefined || hasDynamicChoices(property)
				? []
				: [[key, optionDefaultValue(property)]];
		}),
	);

export const validateOptionValues = (
	schema: AppSchema,
	values: OptionValues,
): ReadonlyMap<string, string> => {
	const input = effectiveConditionInput(schema, values);
	const { fields } = describeOptionFieldsWithInput(schema, input);
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

export const toOptionsPayload = (
	schema: AppSchema,
	values: OptionValues,
): Record<string, JsonValue> => {
	const input = effectiveConditionInput(schema, values);
	const payload: Record<string, JsonValue> = {};
	for (const field of describeOptionFieldsWithInput(schema, input).fields) {
		const value = values[field.key];
		if (!Object.hasOwn(input, field.key) || !hasOptionValue(value)) {
			continue;
		}
		payload[field.key] = Array.isArray(value) ? [...value] : value;
	}
	return payload;
};
