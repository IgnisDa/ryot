import type { JsonValue } from "@ryot/contract/modules/sandbox/wire";
import type {
	AppChoice,
	AppPropertyDefinition,
	AppSchema,
	AppSchemaRule,
	AppSchemaRuleCondition,
	AppSchemaRulePath,
	AppSchemaRuleValue,
} from "@ryot/contract/schema/property-schema";
import { isAppPropertyRequired } from "@ryot/contract/schema/property-schema";
import { Match } from "effect";

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

export const describeOptionFields = (schema: AppSchema): OptionFieldsDescription => {
	const fields: OptionField[] = [];
	const unsupported: string[] = [];
	for (const [key, property] of Object.entries(schema.fields)) {
		const type = optionFieldType(property);
		const hasDynamicChoices =
			(property.type === "enum" || property.type === "enum-array") &&
			property.choices.kind === "dynamic";
		if (type === undefined || hasDynamicChoices) {
			unsupported.push(key);
			continue;
		}
		fields.push({
			key,
			type,
			label: property.label,
			description: property.description,
			choices: optionFieldChoices(property),
			required: isAppPropertyRequired(property),
		});
	}
	return { fields, unsupported };
};

const optionDefaultValue = (property: AppPropertyDefinition): OptionValue =>
	property.type === "array" || property.type === "object" ? undefined : property.defaultValue;

export const initialOptionValues = (schema: AppSchema): OptionValues =>
	Object.fromEntries(
		describeOptionFields(schema).fields.map((field) => [
			field.key,
			optionDefaultValue(schema.fields[field.key]),
		]),
	);

const isBlankOptionValue = (value: OptionValue) =>
	value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

const isMissingOptionValue = (value: OptionValue) => isBlankOptionValue(value);

const resolveOptionValue = (values: OptionValues, path: AppSchemaRulePath): OptionValue =>
	path.length === 1 ? values[path[0]] : undefined;

const matchesRuleValue = (value: OptionValue, expected: AppSchemaRuleValue) =>
	value === undefined ? expected === null : typeof value !== "object" && value === expected;

const evaluateCondition = (condition: AppSchemaRuleCondition, values: OptionValues): boolean =>
	Match.value(condition).pipe(
		Match.when({ operator: "all" }, (current) =>
			current.conditions.every((inner) => evaluateCondition(inner, values)),
		),
		Match.when({ operator: "any" }, (current) =>
			current.conditions.some((inner) => evaluateCondition(inner, values)),
		),
		Match.when(
			{ operator: "exists" },
			(current) => !isMissingOptionValue(resolveOptionValue(values, current.path)),
		),
		Match.when({ operator: "not_exists" }, (current) =>
			isMissingOptionValue(resolveOptionValue(values, current.path)),
		),
		Match.when({ operator: "eq" }, (current) =>
			matchesRuleValue(resolveOptionValue(values, current.path), current.value),
		),
		Match.when(
			{ operator: "neq" },
			(current) => !matchesRuleValue(resolveOptionValue(values, current.path), current.value),
		),
		Match.when({ operator: "in" }, (current) =>
			current.value.some((expected) =>
				matchesRuleValue(resolveOptionValue(values, current.path), expected),
			),
		),
		Match.when(
			{ operator: "not_in" },
			(current) =>
				!current.value.some((expected) =>
					matchesRuleValue(resolveOptionValue(values, current.path), expected),
				),
		),
		Match.exhaustive,
	);

const requiredRuleKey = (rule: AppSchemaRule, fields: readonly OptionField[]) => {
	if (rule.path.length !== 1) {
		return undefined;
	}
	return fields.find((field) => field.key === rule.path[0])?.key;
};

export const validateOptionValues = (
	schema: AppSchema,
	values: OptionValues,
): ReadonlyMap<string, string> => {
	const { fields } = describeOptionFields(schema);
	const errors = new Map<string, string>();
	for (const field of fields) {
		if (field.required && isMissingOptionValue(values[field.key])) {
			errors.set(field.key, `${field.label} is required`);
		}
	}
	for (const rule of schema.rules ?? []) {
		const key = requiredRuleKey(rule, fields);
		if (key === undefined || errors.has(key) || !isMissingOptionValue(values[key])) {
			continue;
		}
		if (evaluateCondition(rule.when, values)) {
			const label = fields.find((field) => field.key === key)?.label ?? key;
			errors.set(key, rule.message ?? `${label} is required`);
		}
	}
	return errors;
};

export const toOptionsPayload = (
	schema: AppSchema,
	values: OptionValues,
): Record<string, JsonValue> => {
	const payload: Record<string, JsonValue> = {};
	for (const field of describeOptionFields(schema).fields) {
		const value = values[field.key];
		if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
			continue;
		}
		payload[field.key] = Array.isArray(value) ? [...value] : value;
	}
	return payload;
};
