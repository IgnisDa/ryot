import { TemporaryUploadToken } from "@ryot/contract/modules/uploads/schemas";
import {
	type AppPropertyDefinition,
	type AppArrayPropertyValidation,
	type AppNumberPropertyValidation,
	type AppPropertyPrimitiveType,
	type AppPropertyNormalization,
	type AppStringPropertyValidation,
	AppSchema,
	type AppSchemaFields,
	type AppSchemaRule,
	type AppSchemaRuleCondition,
	type AppSchemaRulePath,
	type AppSchemaRuleValue,
	type AppSchemaUnknownKeysPolicy,
	createPropertySchemaMessage,
	isAppPropertyRequired,
	type PropertyValidationError,
	type PropertyValidationIssue,
} from "@ryot/contract/schema/property-schema";
import { Email, HttpUrl } from "@ryot/contract/schema/utils";
import { Result, Effect, Schema, SchemaGetter } from "effect";

import {
	formatValidationError,
	parseErrorToIssues,
	toValidationError,
} from "./property-validation-errors";

type ArrayValueSchema<A = unknown, I = A, R = never> = Schema.Codec<
	ReadonlyArray<A>,
	ReadonlyArray<I>,
	R,
	R
>;
type NumberValueSchema = Schema.Codec<number>;
type PropertyValueSchema = Schema.ConstraintCodec<unknown, unknown>;
export type PropertyValueField = PropertyValueSchema;
type StringValueSchema = Schema.Codec<string>;
type PropertyValues = Record<string, unknown>;

type AppSchemaDefinitionValidationOptions = {
	readonly allowUpload?: boolean;
};

type ValidationResult =
	| { readonly success: true; readonly data: PropertyValues }
	| { readonly success: false; readonly issues: ReadonlyArray<PropertyValidationIssue> };

const dateDecoder = Schema.decodeUnknownResult(Schema.DateFromString);
const dateTimeDecoder = Schema.decodeUnknownResult(Schema.DateTimeUtcFromString);

const isStringRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const getValueAtPath = (input: unknown, path: AppSchemaRulePath) => {
	let value = input;
	for (const segment of path) {
		if (!isStringRecord(value)) {
			return undefined;
		}
		value = value[segment];
	}
	return value;
};

const hasValueAtPath = (input: unknown, path: AppSchemaRulePath) => {
	let value = input;
	for (const segment of path) {
		if (!isStringRecord(value) || !Object.hasOwn(value, segment)) {
			return false;
		}
		value = value[segment];
	}
	return true;
};

const pathsEqual = (left: AppSchemaRulePath, right: AppSchemaRulePath) =>
	left.length === right.length && left.every((segment, index) => segment === right[index]);

const pathStartsWith = (path: AppSchemaRulePath, prefix: AppSchemaRulePath) =>
	prefix.length <= path.length && prefix.every((segment, index) => segment === path[index]);

const unknownKeysPolicyToParseOption = (policy?: AppSchemaUnknownKeysPolicy) => {
	if (policy === "strict") {
		return "error" as const;
	}
	if (policy === "passthrough") {
		return "preserve" as const;
	}
	return "ignore" as const;
};

const roundHalfUp = (value: number, scale: number) => {
	const factor = 10 ** scale;
	return Math.round((value + Number.EPSILON) * factor) / factor;
};

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

export const getAppPropertyDefinitionAtPath = (
	fields: AppSchemaFields,
	path: AppSchemaRulePath,
): AppPropertyDefinition | undefined => {
	let currentFields: AppSchemaFields = fields;
	let currentProperty: AppPropertyDefinition | undefined;
	for (const segment of path) {
		currentProperty = currentFields[segment];
		if (!currentProperty) {
			return undefined;
		}
		currentFields = currentProperty.type === "object" ? currentProperty.properties : {};
	}
	return currentProperty;
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

const collectUploadDefinitionIssues = (
	property: AppPropertyDefinition,
	path: ReadonlyArray<string>,
): ReadonlyArray<PropertyValidationIssue> => {
	if (property.type === "string" && property.format?.kind === "upload") {
		return [
			{
				path: [...path, "format"],
				message: "Upload properties are only allowed in import schemas",
			},
		];
	}
	if (property.type === "array") {
		return collectUploadDefinitionIssues(property.items, [...path, "items"]);
	}
	if (property.type === "object") {
		return Object.entries(property.properties).flatMap(([key, value]) =>
			collectUploadDefinitionIssues(value, [...path, "properties", key]),
		);
	}
	return [];
};

export const validateAppSchemaDefinition = (
	schema: AppSchema,
	options: AppSchemaDefinitionValidationOptions = {},
): ReadonlyArray<PropertyValidationIssue> => {
	const uploadIssues = options.allowUpload
		? []
		: Object.entries(schema.fields).flatMap(([key, property]) =>
				collectUploadDefinitionIssues(property, ["fields", key]),
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
	return [...uploadIssues, ...ruleIssues];
};

const collectUnresolvedDynamicChoiceIssues = (
	property: AppPropertyDefinition,
	path: ReadonlyArray<string>,
): ReadonlyArray<PropertyValidationIssue> => {
	if (
		(property.type === "enum" || property.type === "enum-array") &&
		property.choices.kind === "dynamic"
	) {
		const field = path.join(".");
		return [
			{
				path: [...path, "choices", "source"],
				message: `Dynamic choices for '${field}' must be materialized before property parsing`,
			},
		];
	}
	if (property.type === "array") {
		return collectUnresolvedDynamicChoiceIssues(property.items, [...path, "items"]);
	}
	if (property.type === "object") {
		return Object.entries(property.properties).flatMap(([key, value]) =>
			collectUnresolvedDynamicChoiceIssues(value, [...path, key]),
		);
	}
	return [];
};

const evaluateRuleCondition = (
	condition: AppSchemaRuleCondition,
	input: Record<string, unknown>,
): boolean => {
	if (condition.operator === "all") {
		return condition.conditions.every((value) => evaluateRuleCondition(value, input));
	}
	if (condition.operator === "any") {
		return condition.conditions.some((value) => evaluateRuleCondition(value, input));
	}
	const actual = getValueAtPath(input, condition.path);
	if (condition.operator === "exists") {
		return actual !== undefined;
	}
	if (condition.operator === "not_exists") {
		return actual === undefined;
	}
	if (condition.operator === "eq") {
		return Object.is(actual, condition.value);
	}
	if (condition.operator === "neq") {
		return !Object.is(actual, condition.value);
	}
	if (condition.operator === "in") {
		return condition.value.some((value) => Object.is(actual, value));
	}
	return condition.value.every((value) => !Object.is(actual, value));
};

const collectRequiredPropertyIssues = (
	property: AppPropertyDefinition,
	value: unknown,
	path: ReadonlyArray<string>,
	hiddenPaths: ReadonlyArray<AppSchemaRulePath>,
	requiredRules: ReadonlyArray<AppSchemaRule>,
): ReadonlyArray<PropertyValidationIssue> => {
	if (hiddenPaths.some((hiddenPath) => pathStartsWith(path, hiddenPath))) {
		return [];
	}
	const requiredRule = requiredRules.find((rule) => pathsEqual(rule.path, path));
	const propertyRequired = isAppPropertyRequired(property);
	if (value === undefined || value === null) {
		if (!propertyRequired && !requiredRule) {
			return [];
		}
		return [
			{
				path: [...path],
				message:
					requiredRule?.message ??
					(propertyRequired ? "is missing" : `${path.join(".")} is required`),
			},
		];
	}
	if (property.type === "object" && isStringRecord(value)) {
		return Object.entries(property.properties).flatMap(([key, child]) =>
			collectRequiredPropertyIssues(child, value[key], [...path, key], hiddenPaths, requiredRules),
		);
	}
	if (property.type === "array" && Array.isArray(value)) {
		return value.flatMap((item, index) =>
			collectRequiredPropertyIssues(
				property.items,
				item,
				[...path, String(index)],
				hiddenPaths,
				requiredRules,
			),
		);
	}
	return [];
};

const collectRequiredIssues = (
	schema: AppSchema,
	input: PropertyValues,
	hiddenPaths: ReadonlyArray<AppSchemaRulePath>,
	requiredRules: ReadonlyArray<AppSchemaRule>,
) => {
	const issues = Object.entries(schema.fields).flatMap(([key, property]) =>
		collectRequiredPropertyIssues(property, input[key], [key], hiddenPaths, requiredRules),
	);
	for (const rule of requiredRules) {
		if (
			hiddenPaths.some((path) => pathStartsWith(rule.path, path)) ||
			issues.some((issue) => pathsEqual(issue.path, rule.path))
		) {
			continue;
		}
		const value = getValueAtPath(input, rule.path);
		if (value === undefined || value === null) {
			issues.push({
				path: [...rule.path],
				message: rule.message ?? `${rule.path.join(".")} is required`,
			});
		}
	}
	return issues;
};

const omitValueAtPath = (input: PropertyValues, path: AppSchemaRulePath) => {
	let value: PropertyValues = input;
	for (const segment of path.slice(0, -1)) {
		const child = value[segment];
		if (!isStringRecord(child)) {
			return;
		}
		value = child;
	}
	const key = path.at(-1);
	if (key !== undefined) {
		delete value[key];
	}
};

const dateValueSchema = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
	Schema.check(
		Schema.makeFilter(
			(value) => Result.isSuccess(dateDecoder(value)) || "Expected an ISO 8601 date",
		),
	),
);

const datetimeValueSchema = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter(
			(value) => Result.isSuccess(dateTimeDecoder(value)) || "Expected an ISO 8601 datetime",
		),
	),
);

const applyStringValidation = (
	schema: StringValueSchema,
	validation?: AppStringPropertyValidation,
): StringValueSchema => {
	if (!validation || typeof validation !== "object") {
		return schema;
	}
	let value: StringValueSchema = schema;
	if (validation.minLength !== undefined) {
		value = value.pipe(Schema.check(Schema.isMinLength(validation.minLength)));
	}
	if (validation.maxLength !== undefined) {
		value = value.pipe(Schema.check(Schema.isMaxLength(validation.maxLength)));
	}
	if (validation.pattern !== undefined) {
		value = value.pipe(Schema.check(Schema.isPattern(new RegExp(validation.pattern))));
	}
	return value;
};

const createStringValueSchema = (property: Extract<AppPropertyDefinition, { type: "string" }>) => {
	if (property.format?.kind === "upload") {
		return Schema.Struct({
			...TemporaryUploadToken.fields,
			token: applyStringValidation(Schema.String, property.validation),
		});
	}
	if (property.format?.kind === "url") {
		return applyStringValidation(HttpUrl, property.validation);
	}
	if (property.format?.kind === "email") {
		return applyStringValidation(Email, property.validation);
	}
	return applyStringValidation(Schema.String, property.validation);
};

const applyNumberValidation = (
	schema: NumberValueSchema,
	validation?: AppNumberPropertyValidation,
): NumberValueSchema => {
	if (!validation || typeof validation !== "object") {
		return schema;
	}
	let value: NumberValueSchema = schema;
	if (validation.minimum !== undefined) {
		value = value.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(validation.minimum)));
	}
	if (validation.maximum !== undefined) {
		value = value.pipe(Schema.check(Schema.isLessThanOrEqualTo(validation.maximum)));
	}
	if (validation.exclusiveMinimum !== undefined) {
		value = value.pipe(Schema.check(Schema.isGreaterThan(validation.exclusiveMinimum)));
	}
	if (validation.exclusiveMaximum !== undefined) {
		value = value.pipe(Schema.check(Schema.isLessThan(validation.exclusiveMaximum)));
	}
	if (validation.multipleOf !== undefined) {
		value = value.pipe(Schema.check(Schema.isMultipleOf(validation.multipleOf)));
	}
	return value;
};

const applyArrayValidation = <A, I, R>(
	schema: ArrayValueSchema<A, I, R>,
	validation?: AppArrayPropertyValidation,
): ArrayValueSchema<A, I, R> => {
	let value: ArrayValueSchema<A, I, R> = schema;
	if (validation?.minItems !== undefined) {
		value = value.pipe(Schema.check(Schema.isMinLength(validation.minItems)));
	}
	if (validation?.maxItems !== undefined) {
		value = value.pipe(Schema.check(Schema.isMaxLength(validation.maxItems)));
	}
	return value;
};

const withRoundNormalization = (
	schema: NumberValueSchema,
	normalization?: AppPropertyNormalization,
): NumberValueSchema => {
	if (!normalization) {
		return schema;
	}
	return Schema.Finite.pipe(
		Schema.decodeTo(schema, {
			decode: SchemaGetter.transform((value) => roundHalfUp(value, normalization.round.scale)),
			encode: SchemaGetter.transform((value) => value),
		}),
	);
};

const toStructField = (property: AppPropertyDefinition): PropertyValueField => {
	const valueSchema = createPropertyValueSchema(property);
	if (property.defaultValue !== undefined) {
		return Schema.withDecodingDefaultTypeKey<typeof valueSchema>(
			Effect.sync(() => property.defaultValue),
		)(valueSchema);
	}
	return Schema.optional(valueSchema);
};

const createObjectValueSchema = (
	fields: AppSchemaFields,
	unknownKeys?: AppSchemaUnknownKeysPolicy,
) => {
	const shape: Record<string, PropertyValueField> = {};
	for (const [key, value] of Object.entries(fields)) {
		shape[key] = toStructField(value);
	}
	return Schema.Struct(shape).annotate({
		parseOptions: { onExcessProperty: unknownKeysPolicyToParseOption(unknownKeys) },
	});
};

const isManagedAsset = (value: unknown) => {
	if (!isStringRecord(value)) {
		return false;
	}
	if (value["type"] === "remote") {
		return (
			typeof value["url"] === "string" &&
			value["url"].trim().length > 0 &&
			value["key"] === undefined
		);
	}
	return (
		(value["type"] === "local" || value["type"] === "s3") &&
		typeof value["key"] === "string" &&
		value["key"].trim().length > 0 &&
		value["url"] === undefined
	);
};

const createPropertyValueSchema = (property: AppPropertyDefinition): PropertyValueSchema => {
	if (property.type === "string") {
		return Schema.NullOr(createStringValueSchema(property));
	}
	if (property.type === "date") {
		return Schema.NullOr(dateValueSchema);
	}
	if (property.type === "datetime") {
		return Schema.NullOr(datetimeValueSchema);
	}
	if (property.type === "boolean") {
		return Schema.NullOr(Schema.Boolean);
	}
	if (property.type === "number") {
		const value = withRoundNormalization(
			applyNumberValidation(Schema.Finite, property.validation),
			property.normalize,
		);
		return Schema.NullOr(value);
	}
	if (property.type === "integer") {
		const value = withRoundNormalization(
			applyNumberValidation(Schema.Finite.pipe(Schema.check(Schema.isInt())), property.validation),
			property.normalize,
		);
		return Schema.NullOr(value);
	}
	if (property.type === "enum") {
		if (property.choices.kind === "dynamic") {
			return Schema.String.pipe(
				Schema.check(
					Schema.makeFilter(() => "Dynamic choices must be materialized before property parsing"),
				),
			);
		}
		const choices = new Set(property.choices.values.map((choice) => choice.value));
		const value = Schema.String.pipe(
			Schema.check(
				Schema.makeFilter((item) => choices.has(item) || "Expected one of the enum choices"),
			),
		);
		return Schema.NullOr(value);
	}
	if (property.type === "enum-array") {
		if (property.choices.kind === "dynamic") {
			return Schema.Array(
				Schema.String.pipe(
					Schema.check(
						Schema.makeFilter(() => "Dynamic choices must be materialized before property parsing"),
					),
				),
			);
		}
		const choices = new Set(property.choices.values.map((choice) => choice.value));
		const item = Schema.String.pipe(
			Schema.check(
				Schema.makeFilter((value) => choices.has(value) || "Expected one of the enum choices"),
			),
		);
		const value = applyArrayValidation(Schema.Array(item), property.validation);
		return Schema.NullOr(value);
	}
	if (property.type === "array") {
		const value = applyArrayValidation(
			Schema.Array(createPropertyValueSchema(property.items)),
			property.validation,
		);
		return Schema.NullOr(value);
	}
	const objectSchema = createObjectValueSchema(property.properties, property.unknownKeys);
	const value = property.validation?.asset
		? objectSchema.pipe(Schema.check(Schema.makeFilter(isManagedAsset)))
		: objectSchema;
	return Schema.NullOr(value);
};

const createPropertiesValueSchema = (schema: AppSchema) =>
	createObjectValueSchema(schema.fields, schema.unknownKeys);

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

export const parseAppSchemaPropertiesSafe = (input: {
	kind?: string;
	properties: unknown;
	propertiesSchema: AppSchema;
}): ValidationResult => {
	if (!isStringRecord(input.properties)) {
		return {
			success: false,
			issues: [
				{
					path: [],
					message: input.kind
						? `${input.kind} properties must be a JSON object${Array.isArray(input.properties) ? ", not an array" : ""}`
						: `Properties must be a JSON object${Array.isArray(input.properties) ? ", not an array" : ""}`,
				},
			],
		};
	}
	const dynamicChoiceIssues = Object.entries(input.propertiesSchema.fields).flatMap(
		([key, property]) => collectUnresolvedDynamicChoiceIssues(property, [key]),
	);
	if (dynamicChoiceIssues.length > 0) {
		return { success: false, issues: dynamicChoiceIssues };
	}
	const decoded = Schema.decodeUnknownResult(createPropertiesValueSchema(input.propertiesSchema))(
		input.properties,
	);
	if (Result.isFailure(decoded)) {
		return { success: false, issues: parseErrorToIssues(decoded.failure) };
	}
	const activeRules = (input.propertiesSchema.rules ?? []).filter((rule) =>
		evaluateRuleCondition(rule.when, decoded.success),
	);
	const visibilityRules = activeRules.filter((rule) => rule.kind === "visibility");
	const hiddenPaths = visibilityRules.map((rule) => rule.path);
	const hiddenIssues = visibilityRules.flatMap((rule) =>
		hasValueAtPath(input.properties, rule.path)
			? [
					{
						path: [...rule.path],
						message: rule.message ?? `${rule.path.join(".")} must be absent when hidden`,
					},
				]
			: [],
	);
	if (hiddenIssues.length > 0) {
		return { success: false, issues: hiddenIssues };
	}
	const requiredRules = activeRules.filter((rule) => rule.kind === "validation");
	const requiredIssues = collectRequiredIssues(
		input.propertiesSchema,
		decoded.success,
		hiddenPaths,
		requiredRules,
	);
	if (requiredIssues.length > 0) {
		return { success: false, issues: requiredIssues };
	}
	for (const path of hiddenPaths) {
		omitValueAtPath(decoded.success, path);
	}
	return { success: true, data: decoded.success };
};

export const parseAppSchemaProperties = (input: {
	kind: string;
	properties: unknown;
	propertiesSchema: AppSchema;
}): Effect.Effect<Record<string, unknown>, PropertyValidationError> => {
	const result = parseAppSchemaPropertiesSafe(input);
	return result.success
		? Effect.succeed(result.data)
		: Effect.fail(toValidationError(result.issues));
};

export const formatPropertyIssues = (issues: ReadonlyArray<PropertyValidationIssue>) =>
	formatValidationError(issues).join("; ");
