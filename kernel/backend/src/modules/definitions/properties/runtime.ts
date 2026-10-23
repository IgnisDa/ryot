import {
	type AppPropertyDefinition,
	type AppPropertyPrimitiveType,
	AppSchema,
	type AppSchemaFields,
	type AppSchemaRuleCondition,
	type AppSchemaRuleValue,
	createPropertySchemaMessage,
	getAppPropertyDefinitionAtPath,
	type PropertyValidationError,
	type PropertyValidationIssue,
} from "@ryot-app/contract/schema/property-schema";
import {
	formatValidationError,
	parseErrorToIssues,
	toValidationError,
} from "@ryot-app/contract/schema/property-validation";
import { parseAppSchemaPropertiesSafe } from "@ryot-app/contract/schema/property-values";
import { Effect, Result, Schema } from "effect";

type AppSchemaDefinitionValidationOptions = { readonly allowUpload?: boolean };

const isComparableType = (
	type: AppPropertyDefinition["type"],
): AppPropertyPrimitiveType | undefined => {
	if (type === "enum") {
		return "string";
	}
	if (type === "string" || type === "number" || type === "integer") {
		return type;
	}
	if (type === "boolean" || type === "date" || type === "datetime") {
		return type;
	}
	return undefined;
};

const isCompatibleRuleValue = (type: AppPropertyPrimitiveType, value: AppSchemaRuleValue) => {
	if (type === "boolean") {
		return typeof value === "boolean";
	}
	if (type === "integer") {
		return typeof value === "number" && Number.isInteger(value);
	}
	if (type === "number") {
		return typeof value === "number" && Number.isFinite(value);
	}
	return typeof value === "string";
};

const collectConditionDefinitionIssues = (
	fields: AppSchemaFields,
	condition: AppSchemaRuleCondition,
	path: ReadonlyArray<string>,
): PropertyValidationIssue[] => {
	if (condition.operator === "all" || condition.operator === "any") {
		return condition.conditions.flatMap((value, index) =>
			collectConditionDefinitionIssues(fields, value, [...path, "conditions", String(index)]),
		);
	}
	const property = getAppPropertyDefinitionAtPath(fields, condition.path);
	if (!property) {
		return [
			{
				path: [...path, "path"],
				message: `Rule condition path '${condition.path.join(".")}' does not exist`,
			},
		];
	}
	if (condition.operator === "exists" || condition.operator === "not_exists") {
		return [];
	}
	const comparableType = isComparableType(property.type);
	if (!comparableType) {
		return [
			{
				path: [...path, "path"],
				message:
					"Rule conditions can only compare primitive string, number, integer, boolean, date, or datetime properties",
			},
		];
	}
	const values = Array.isArray(condition.value) ? condition.value : [condition.value];
	return values.every((value) => isCompatibleRuleValue(comparableType, value))
		? []
		: [
				{
					path: [...path, "value"],
					message: `Rule condition values must match the '${comparableType}' property type`,
				},
			];
};

const collectFormatDefinitionIssues = (
	property: AppPropertyDefinition,
	path: ReadonlyArray<string>,
	isTopLevel: boolean,
	allowUpload: boolean,
): ReadonlyArray<PropertyValidationIssue> => {
	if (property.type === "string" && property.format?.kind === "upload") {
		return [
			...(!allowUpload
				? [
						{
							path: [...path, "format"],
							message: "Upload properties are only allowed in import schemas",
						},
					]
				: []),
			...(!isTopLevel
				? [{ path: [...path, "format"], message: "The upload format must be top-level" }]
				: []),
		];
	}
	if (property.type === "string" && property.format?.kind === "oauth-connection") {
		return isTopLevel
			? []
			: [{ path: [...path, "format"], message: "The oauth-connection format must be top-level" }];
	}
	if (property.type === "array") {
		return collectFormatDefinitionIssues(property.items, [...path, "items"], false, allowUpload);
	}
	if (property.type === "object") {
		return Object.entries(property.properties).flatMap(([key, value]) =>
			collectFormatDefinitionIssues(value, [...path, "properties", key], false, allowUpload),
		);
	}
	return [];
};

export const validateAppSchemaDefinition = (
	schema: AppSchema,
	options: AppSchemaDefinitionValidationOptions = {},
): ReadonlyArray<PropertyValidationIssue> => {
	const formatIssues = Object.entries(schema.fields).flatMap(([key, property]) =>
		collectFormatDefinitionIssues(property, ["fields", key], true, options.allowUpload === true),
	);
	const ruleIssues = (schema.rules ?? []).flatMap((rule, index) => {
		const property = getAppPropertyDefinitionAtPath(schema.fields, rule.path);
		const path = ["rules", String(index)];
		if (!property) {
			return [
				{ path: [...path, "path"], message: `Rule path '${rule.path.join(".")}' does not exist` },
			];
		}
		return collectConditionDefinitionIssues(schema.fields, rule.when, [...path, "when"]);
	});
	return [...formatIssues, ...ruleIssues];
};

const decodeAppSchemaEither = (input: unknown, emptyFieldsMessage?: string) => {
	const decoded = Schema.decodeUnknownResult(Schema.toType(AppSchema))(input);
	if (Result.isFailure(decoded)) {
		return Result.fail(toValidationError(parseErrorToIssues(decoded.failure)));
	}
	const appSchema = decoded.success;
	if (emptyFieldsMessage && Object.keys(appSchema.fields).length === 0) {
		return Result.fail(toValidationError([{ path: [], message: emptyFieldsMessage }]));
	}
	const issues = validateAppSchemaDefinition(appSchema);
	return issues.length > 0 ? Result.fail(toValidationError(issues)) : Result.succeed(appSchema);
};

const parsePropertySchemaInput = (
	input: unknown,
	labels: { propertiesLabel: string },
): Effect.Effect<AppSchema, PropertyValidationError> => {
	const decoded = decodeAppSchemaEither(input, createPropertySchemaMessage(labels.propertiesLabel));
	return Result.isSuccess(decoded) ? Effect.succeed(decoded.success) : Effect.fail(decoded.failure);
};

export const parseLabeledPropertySchemaInput = (input: unknown, propertiesLabel: string) =>
	parsePropertySchemaInput(input, { propertiesLabel });

export const parseAppSchemaProperties = (input: {
	kind: string;
	properties: unknown;
	propertiesSchema: AppSchema;
	allowedMissingRequiredPaths?: ReadonlyArray<ReadonlyArray<string>>;
}): Effect.Effect<Record<string, unknown>, PropertyValidationError> => {
	const result = parseAppSchemaPropertiesSafe(input);
	return result.success
		? Effect.succeed(result.data)
		: Effect.fail(toValidationError(result.issues));
};

export const formatPropertyIssues = (issues: ReadonlyArray<PropertyValidationIssue>) =>
	formatValidationError(issues).join("; ");
