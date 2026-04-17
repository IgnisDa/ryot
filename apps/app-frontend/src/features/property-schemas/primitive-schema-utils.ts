import type {
	AppPropertyDefinition,
	AppSchema,
	AppSchemaRuleCondition,
} from "@ryot/ts-utils";
import { fromAppSchemaObject, isAppPropertyRequired } from "@ryot/ts-utils";
import { match } from "ts-pattern";

export function isPrimitiveProperty(
	propertyDef: AppPropertyDefinition,
): boolean {
	return match(propertyDef.type)
		.with(
			"boolean",
			"date",
			"datetime",
			"integer",
			"number",
			"string",
			() => true,
		)
		.otherwise(() => false);
}

export const getDefaultValue = (
	propertyDef: AppPropertyDefinition,
): unknown => {
	return match(propertyDef.type)
		.with("string", "date", "datetime", () => "")
		.with("number", "integer", () => 0)
		.with("boolean", () => false)
		.otherwise(() => undefined);
};

export function isValidPropertyValue(
	propertyDef: AppPropertyDefinition,
	value: unknown,
): boolean {
	return match(propertyDef.type)
		.with("string", "date", "datetime", () => typeof value === "string")
		.with("number", () => typeof value === "number" && Number.isFinite(value))
		.with("integer", () => Number.isInteger(value))
		.with("boolean", () => typeof value === "boolean")
		.otherwise(() => false);
}

export function isSupportedPrimitiveRuleCondition(
	condition: AppSchemaRuleCondition,
	supportedKeys: Set<string>,
): boolean {
	return match(condition)
		.with({ operator: "all" }, { operator: "any" }, (cond) =>
			cond.conditions.every((value) =>
				isSupportedPrimitiveRuleCondition(value, supportedKeys),
			),
		)
		.otherwise(
			(cond) => cond.path.length === 1 && supportedKeys.has(cond.path[0] ?? ""),
		);
}

export const buildPrimitivePropertiesSchema = (propertiesSchema: AppSchema) => {
	const fields: AppSchema["fields"] = {};
	const supportedKeys = new Set<string>();

	for (const [key, propertyDef] of Object.entries(propertiesSchema.fields)) {
		if (!isPrimitiveProperty(propertyDef)) {
			continue;
		}

		supportedKeys.add(key);
		fields[key] = propertyDef;
	}

	return fromAppSchemaObject(
		{
			fields,
			rules: propertiesSchema.rules?.filter(
				(rule) =>
					isSupportedPrimitiveRuleCondition(rule.when, supportedKeys) &&
					rule.path.length === 1 &&
					supportedKeys.has(rule.path[0] ?? ""),
			),
		},
		{ unknownKeys: "strip" },
	);
};

export function reconcilePrimitiveProperties(
	propertiesSchema: AppSchema,
	currentProperties: Record<string, unknown>,
): Record<string, unknown> {
	const properties: Record<string, unknown> = {};

	for (const [key, propertyDef] of Object.entries(propertiesSchema.fields)) {
		if (!isPrimitiveProperty(propertyDef)) {
			continue;
		}

		const currentValue = currentProperties[key];
		if (isValidPropertyValue(propertyDef, currentValue)) {
			properties[key] = currentValue;
			continue;
		}

		const defaultValue = getDefaultValue(propertyDef);
		if (isAppPropertyRequired(propertyDef) && defaultValue !== undefined) {
			properties[key] = defaultValue;
		}
	}

	return properties;
}

export function getUnsupportedRequiredProperties(schema: AppSchema): string[] {
	return Object.entries(schema.fields)
		.filter(
			([, propertyDef]) =>
				isAppPropertyRequired(propertyDef) && !isPrimitiveProperty(propertyDef),
		)
		.map(([key]) => key);
}
