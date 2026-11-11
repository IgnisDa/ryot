import { Result, Schema } from "effect";

import { validateAppSchemaDefinition } from "../../schema/app-schema-definition";
import {
	type AppPropertyDefinition,
	AppSchema,
	type PropertyValidationIssue,
} from "../../schema/property-schema";
import { parseAppSchemaPropertiesSafe } from "../../schema/property-values";

const propertyIssues = (
	property: AppPropertyDefinition,
	path: readonly string[],
): readonly PropertyValidationIssue[] => {
	if (property.type === "object") {
		return [{ path, message: "Query parameters cannot be objects" }];
	}
	const issues: PropertyValidationIssue[] = [];
	if (property.secret) {
		issues.push({ path, message: "Query parameters cannot be secret" });
	}
	if (
		(property.type === "enum" || property.type === "enum-array") &&
		property.choices.kind !== "static"
	) {
		issues.push({ path, message: "Query parameters require static choices" });
	}
	if (
		property.type === "string" &&
		(property.format?.kind === "upload" || property.format?.kind === "oauth-connection")
	) {
		issues.push({ path, message: "Query parameters cannot use upload or OAuth formats" });
	}
	if (property.type === "array") {
		issues.push(...propertyIssues(property.items, [...path, "items"]));
	}
	return issues;
};

export const validateParameterSchema = (schema: AppSchema): readonly PropertyValidationIssue[] => {
	const issues = [
		...validateAppSchemaDefinition(schema, { parameterReferences: true }),
		...Object.entries(schema.fields).flatMap(([key, property]) =>
			propertyIssues(property, ["fields", key]),
		),
	];
	if (schema.unknownKeys !== undefined && schema.unknownKeys !== "strict") {
		issues.push({ path: ["unknownKeys"], message: "Query arguments always reject unknown keys" });
	}
	for (const [key, property] of Object.entries(schema.fields)) {
		if (property.defaultValue === undefined) {
			continue;
		}
		const parsed = parseAppSchemaPropertiesSafe({
			properties: { [key]: property.defaultValue },
			propertiesSchema: { fields: { [key]: property } },
		});
		if (!parsed.success) {
			issues.push(...parsed.issues);
		}
	}
	return issues;
};

export const ParameterSchema = AppSchema.check(
	Schema.makeFilter(
		(schema) => validateParameterSchema(schema).length === 0 || "Invalid query parameter schema",
	),
);

export const bindArguments = (schema: AppSchema | undefined, input: unknown = {}) => {
	const definition = schema ?? { fields: {} };
	const issues = validateParameterSchema(definition);
	if (issues.length > 0) {
		return Result.fail(issues);
	}
	const parsed = parseAppSchemaPropertiesSafe({
		properties: input,
		propertiesSchema: { ...definition, unknownKeys: "strict" },
	});
	return parsed.success ? Result.succeed(parsed.data) : Result.fail(parsed.issues);
};
