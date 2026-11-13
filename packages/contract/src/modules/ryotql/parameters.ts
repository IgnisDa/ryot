import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Result, Schema } from "effect";

import { validateAppSchemaDefinition } from "../../schema/app-schema-definition";
import {
	type AppPropertyDefinition,
	AppSchema,
	type PropertyValidationIssue,
} from "../../schema/property-schema";
import { formatPropertyIssues } from "../../schema/property-validation";
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

const bindParameterArguments = (
	schema: AppSchema | undefined,
	input: unknown,
	partial: boolean,
) => {
	const definition = schema ?? { fields: {} };
	const issues = validateParameterSchema(definition);
	if (issues.length > 0) {
		return Result.fail(issues);
	}
	const parsed = parseAppSchemaPropertiesSafe({
		properties: input,
		propertiesSchema: { ...definition, unknownKeys: "strict" },
		allowedMissingRequiredPaths: partial
			? Object.keys(definition.fields)
					.filter((key) => !isObjectRecord(input) || !Object.hasOwn(input, key))
					.map((key) => [key])
			: [],
	});
	return parsed.success
		? Result.succeed(
				Object.fromEntries(
					Object.entries(parsed.data).filter(
						([key]) => !partial || (isObjectRecord(input) && Object.hasOwn(input, key)),
					),
				),
			)
		: Result.fail(parsed.issues);
};

export const argumentIssuesMessage = (issues: readonly PropertyValidationIssue[]) =>
	`Invalid arguments: ${formatPropertyIssues(issues)}`;

export const bindArguments = (schema: AppSchema | undefined, input: unknown = {}) =>
	bindParameterArguments(schema, input, false);

export const bindPartialArguments = (schema: AppSchema | undefined, input: unknown = {}) =>
	bindParameterArguments(schema, input, true);

export type ParameterExposureRisk = "bounded" | "free-text" | "identifier";

export const parameterExposureRisk = (property: AppPropertyDefinition): ParameterExposureRisk => {
	if (property.type === "array") {
		return parameterExposureRisk(property.items);
	}
	if (property.type !== "string") {
		return "bounded";
	}
	if (property.reference !== undefined) {
		return "identifier";
	}
	return property.format === undefined ? "free-text" : "bounded";
};
