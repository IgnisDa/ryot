import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Result, Schema } from "effect";

import { validateAppSchemaDefinition } from "../../schema/app-schema-definition";
import type { Entitlement } from "../../schema/entitlement";
import {
	type AppPropertyDefinition,
	AppSchema,
	type PropertyValidationIssue,
} from "../../schema/property-schema";
import { formatPropertyIssues } from "../../schema/property-validation";
import { parseAppSchemaPropertiesSafe } from "../../schema/property-values";
import { AuthoredAppSchema } from "../plugins/manifest-text";

const propertyIssues = (
	property: AppPropertyDefinition<unknown>,
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

const staticChoices = (property: AppPropertyDefinition<unknown>) =>
	(property.type === "enum" || property.type === "enum-array") && property.choices.kind === "static"
		? property.choices.values
		: [];

const impliedArgumentIssues = (schema: AppSchema<unknown>): readonly PropertyValidationIssue[] =>
	Object.entries(schema.fields).flatMap(([key, property]) =>
		staticChoices(property).flatMap((choice, index) =>
			Object.entries(choice.implies ?? {}).flatMap(([target, value]) => {
				const path = ["fields", key, "choices", "values", String(index), "implies", target];
				const field = schema.fields[target];
				if (property.type !== "enum" || field === undefined || target === key) {
					return [{ path, message: "Enum choices may imply only other parameters" }];
				}
				const parsed = parseAppSchemaPropertiesSafe({
					properties: { [target]: value },
					propertiesSchema: { fields: { [target]: field } },
				});
				return parsed.success ? [] : parsed.issues;
			}),
		),
	);

const impliedArguments = (schema: AppSchema<unknown>, bound: Readonly<Record<string, unknown>>) =>
	Object.fromEntries(
		Object.entries(schema.fields).flatMap(([key, property]) =>
			Object.entries(
				staticChoices(property).find((choice) => choice.value === bound[key])?.implies ?? {},
			),
		),
	);

export const validateParameterSchema = (
	schema: AppSchema<unknown>,
): readonly PropertyValidationIssue[] => {
	const issues = [
		...validateAppSchemaDefinition(schema, { parameterReferences: true }),
		...Object.entries(schema.fields).flatMap(([key, property]) =>
			propertyIssues(property, ["fields", key]),
		),
		...impliedArgumentIssues(schema),
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

const parameterSchema = <Text>(schema: Schema.Codec<AppSchema<Text>, unknown>) =>
	schema.check(
		Schema.makeFilter(
			(value) => validateParameterSchema(value).length === 0 || "Invalid query parameter schema",
		),
	);

export const ParameterSchema = parameterSchema(AppSchema);

/** Parameters authored in plugin or kernel code: labels are manifest text or kernel messages. */
export const PluginParameterSchema = parameterSchema(AuthoredAppSchema);

const bindParameterArguments = (
	schema: undefined | AppSchema<unknown>,
	input: unknown,
	partial: boolean,
) => {
	const definition = schema ?? { fields: {} };
	const issues = validateParameterSchema(definition);
	if (issues.length > 0) {
		return Result.fail(issues);
	}
	const parse = (properties: unknown) =>
		parseAppSchemaPropertiesSafe({
			properties,
			propertiesSchema: { ...definition, unknownKeys: "strict" },
			allowedMissingRequiredPaths: partial
				? Object.keys(definition.fields)
						.filter((key) => !isObjectRecord(input) || !Object.hasOwn(input, key))
						.map((key) => [key])
				: [],
		});
	const initial = parse(input);
	const implied = initial.success && !partial ? impliedArguments(definition, initial.data) : {};
	const parsed =
		Object.keys(implied).length === 0 || !isObjectRecord(input)
			? initial
			: parse({ ...input, ...implied });
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

export const bindArguments = (schema: undefined | AppSchema<unknown>, input: unknown = {}) =>
	bindParameterArguments(schema, input, false);

export const bindPartialArguments = (schema: undefined | AppSchema<unknown>, input: unknown = {}) =>
	bindParameterArguments(schema, input, true);

export const argumentEntitlements = (
	schema: undefined | AppSchema<unknown>,
	input: unknown = {},
) => {
	const bound = bindArguments(schema, input);
	if (Result.isFailure(bound)) {
		return [];
	}
	return Object.entries(schema?.fields ?? {}).flatMap(([key, property]): Entitlement[] => {
		if (
			(property.type !== "enum" && property.type !== "enum-array") ||
			property.choices.kind !== "static"
		) {
			return [];
		}
		const value = bound.success[key];
		const selected = Array.isArray(value) ? value : [value];
		return property.choices.values.flatMap((choice) =>
			choice.entitlement !== undefined && selected.includes(choice.value)
				? [choice.entitlement]
				: [],
		);
	});
};

export type ParameterExposureRisk = "bounded" | "free-text" | "identifier";

export const parameterExposureRisk = (
	property: AppPropertyDefinition<unknown>,
): ParameterExposureRisk => {
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
