import { isUnknownArray } from "@ryot-app/ts-utils/predicates";

import {
	type AppPropertyDefinition,
	type AppPropertyPrimitiveType,
	type AppSchema,
	type AppSchemaFields,
	type AppSchemaRuleCondition,
	type AppSchemaRuleValue,
	getAppPropertyDefinitionAtPath,
	isEventReferenceProperty,
	type PropertyValidationIssue,
} from "./property-schema";

type AppSchemaDefinitionValidationOptions = {
	readonly allowUpload?: boolean;
	readonly parameterReferences?: boolean;
	readonly allowEventReferences?: boolean;
};

const isComparableType = (
	type: AppPropertyDefinition["type"],
): undefined | AppPropertyPrimitiveType => {
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
	const values = isUnknownArray(condition.value) ? condition.value : [condition.value];
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

const collectEventReferenceIssues = (
	property: AppPropertyDefinition,
	path: ReadonlyArray<string>,
	allowed: boolean,
): ReadonlyArray<PropertyValidationIssue> => {
	if (property.type === "array") {
		return collectEventReferenceIssues(property.items, [...path, "items"], false);
	}
	if (property.type === "object") {
		return Object.entries(property.properties).flatMap(([key, value]) =>
			collectEventReferenceIssues(value, [...path, "properties", key], false),
		);
	}
	if (!isEventReferenceProperty(property)) {
		return [];
	}
	if (!allowed) {
		return [
			{
				path: [...path, "reference"],
				message: "Event references must be top-level event properties",
			},
		];
	}
	return property.reference.required === true ||
		property.validation?.required === true ||
		property.immutable === true
		? [{ path: [...path, "reference"], message: "Event references must be optional and mutable" }]
		: [];
};

export const validateAppSchemaDefinition = (
	schema: AppSchema,
	options: AppSchemaDefinitionValidationOptions = {},
): ReadonlyArray<PropertyValidationIssue> => {
	const formatIssues = Object.entries(schema.fields).flatMap(([key, property]) =>
		collectFormatDefinitionIssues(property, ["fields", key], true, options.allowUpload === true),
	);
	const referenceIssues = options.parameterReferences
		? []
		: Object.entries(schema.fields).flatMap(([key, property]) =>
				collectEventReferenceIssues(
					property,
					["fields", key],
					options.allowEventReferences === true,
				),
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
	const requiredReferenceIssues = options.parameterReferences
		? []
		: (schema.rules ?? []).flatMap((rule, index) => {
				const property = getAppPropertyDefinitionAtPath(schema.fields, rule.path);
				return rule.kind === "validation" && isEventReferenceProperty(property)
					? [
							{
								path: ["rules", String(index), "path"],
								message: "Event references cannot be required by rules",
							},
						]
					: [];
			});
	return [...formatIssues, ...referenceIssues, ...ruleIssues, ...requiredReferenceIssues];
};
