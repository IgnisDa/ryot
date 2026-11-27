import { isJsonValue, type JsonValue } from "./json";
import type {
	AppPropertyDefinition,
	AppSchema,
	AppSchemaFields,
	AppSchemaRuleCondition,
} from "./property-schema";

const jsonDefault = (value: unknown): JsonValue => {
	if (!isJsonValue(value)) {
		throw new Error("AppSchema defaults must be JSON values");
	}
	return value;
};

type JsonSchema = Readonly<Record<string, JsonValue>>;

const atPath = (path: readonly string[], constraint: JsonSchema): JsonSchema => {
	const [key, ...rest] = path;
	return key === undefined
		? constraint
		: { type: "object", required: [key], properties: { [key]: atPath(rest, constraint) } };
};

const conditionSchema = (condition: AppSchemaRuleCondition): JsonSchema => {
	if (condition.operator === "all" || condition.operator === "any") {
		return {
			[condition.operator === "all" ? "allOf" : "anyOf"]: condition.conditions.map(conditionSchema),
		};
	}
	const exists = atPath(condition.path, { not: { enum: [null] } });
	if (condition.operator === "exists") {
		return exists;
	}
	if (condition.operator === "not_exists") {
		return { not: exists };
	}
	const matches = atPath(
		condition.path,
		"value" in condition
			? { enum: Array.isArray(condition.value) ? condition.value : [condition.value] }
			: {},
	);
	return condition.operator === "neq" || condition.operator === "not_in"
		? { not: matches }
		: matches;
};

type Title<Text> = (text: Text) => string;

const objectSchema = <Text>(
	fields: AppSchemaFields<Text>,
	unknownKeys: AppSchema<Text>["unknownKeys"],
	title: Title<Text>,
): JsonSchema => ({
	type: "object",
	additionalProperties: unknownKeys !== "strict",
	properties: Object.fromEntries(
		Object.entries(fields).map(([key, property]) => [key, propertySchema(property, title)]),
	),
	required: Object.entries(fields).flatMap(([key, property]) =>
		property.validation?.required === true && property.defaultValue === undefined ? [key] : [],
	),
});

const propertySchema = <Text>(
	property: AppPropertyDefinition<Text>,
	title: Title<Text>,
): JsonSchema => {
	const { required: _, ...constraints } = property.validation ?? {};
	let value: JsonSchema;
	switch (property.type) {
		case "enum":
		case "enum-array": {
			if (property.choices.kind === "dynamic") {
				throw new Error("Materialize dynamic choices before JSON Schema conversion");
			}
			const choices = {
				type: "string",
				enum: property.choices.values.map((choice) => choice.value),
			};
			value = property.type === "enum" ? choices : { type: "array", items: choices };
			break;
		}
		case "date":
			value = { type: "string", format: "date" };
			break;
		case "array":
			value = { type: "array", items: propertySchema(property.items, title) };
			break;
		case "object":
			value = objectSchema(property.properties, property.unknownKeys, title);
			break;
		case "string":
			value = {
				type: "string",
				...(property.format?.kind === "email" ? { format: "email" } : {}),
				...(property.format?.kind === "url" ? { format: "uri" } : {}),
			};
			break;
		case "datetime":
			value = { type: "string", format: "date-time" };
			break;
		case "number":
		case "boolean":
		case "integer":
			value = { type: property.type };
	}
	const nonNull = { ...value, ...constraints };
	return {
		title: title(property.label),
		description: property.description,
		...(property.secret ? { writeOnly: true } : {}),
		...(property.defaultValue === undefined ? {} : { default: jsonDefault(property.defaultValue) }),
		...(property.validation?.required ? nonNull : { anyOf: [nonNull, { type: "null" }] }),
	};
};

/** `title` renders property labels for the JSON Schema reader, such as a model. */
export const appSchemaJsonSchema = <Text>(
	schema: AppSchema<Text>,
	title: Title<Text>,
): JsonSchema => ({
	$schema: "https://json-schema.org/draft/2020-12/schema",
	...objectSchema(schema.fields, schema.unknownKeys, title),
	...((schema.rules?.length ?? 0) === 0
		? {}
		: {
				allOf:
					schema.rules?.map((rule) => ({
						anyOf: [
							{ not: conditionSchema(rule.when) },
							rule.kind === "visibility"
								? { not: atPath(rule.path, {}) }
								: atPath(rule.path, { not: { enum: [null] } }),
						],
					})) ?? [],
			}),
});
