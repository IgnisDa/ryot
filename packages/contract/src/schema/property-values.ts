import { Effect, Result, Schema, SchemaGetter } from "effect";

import { roundHalfUp } from "./numeric-normalization";
import {
	type AppArrayPropertyValidation,
	type AppNumberPropertyValidation,
	type AppPropertyDefinition,
	type AppPropertyNormalization,
	type AppSchema,
	type AppSchemaFields,
	type AppSchemaRule,
	type AppSchemaRuleCondition,
	type AppSchemaRulePath,
	type AppSchemaUnknownKeysPolicy,
	type AppStringPropertyValidation,
	areAppSchemaPathsEqual,
	evaluateAppSchemaRuleCondition,
	getAppPropertyDefinitionAtPath,
	getAppSchemaValueAtPath,
	isAppPropertyRequired,
	isAppSchemaPathEffectivelyRequired,
	isAppSchemaPathHidden,
	isMissingAppSchemaRequiredValue,
	type PropertyValidationIssue,
} from "./property-schema";
import { parseErrorToIssues } from "./property-validation";
import { Email, HttpUrl, isNamedTimeZone } from "./utils";

type ArrayValueSchema<A = unknown, I = A, R = never> = Schema.Codec<
	ReadonlyArray<A>,
	ReadonlyArray<I>,
	R,
	R
>;
type NumberValueSchema = Schema.Codec<number>;
type PropertyValueSchema = Schema.ConstraintCodec<unknown, unknown>;
type PropertyValueField = PropertyValueSchema;
type StringValueSchema = Schema.Codec<string>;
type PropertyValues = Record<string, unknown>;

type ValidationResult =
	| { readonly success: true; readonly data: PropertyValues }
	| { readonly success: false; readonly issues: ReadonlyArray<PropertyValidationIssue> };

const dateDecoder = Schema.decodeUnknownResult(Schema.DateFromString);
const dateTimeDecoder = Schema.decodeUnknownResult(Schema.DateTimeUtcFromString);

const isStringRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

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

const applyUnknownKeysPolicy = <Fields extends Schema.Struct.Fields>(
	struct: Schema.Struct<Fields>,
	policy?: AppSchemaUnknownKeysPolicy,
) => {
	if (policy === "passthrough") {
		return Schema.StructWithRest(struct, [Schema.Record(Schema.String, Schema.Unknown)]);
	}
	if (policy !== "strict") {
		return struct;
	}
	const declared = new Set(Object.keys(struct.fields));
	const excessKey = Schema.String.check(
		Schema.makeFilter((key: string) => (declared.has(key) ? "declared property" : undefined)),
	);
	const strict = Schema.StructWithRest(struct, [
		Schema.Record(excessKey, Schema.Never.annotate({ identifier: "no excess property" })),
	]);
	return struct.rebuild(strict.ast);
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

const canEvaluateRuleConditionFromRawInput = (
	schema: AppSchema,
	condition: AppSchemaRuleCondition,
	input: unknown,
): boolean => {
	if (condition.operator === "all" || condition.operator === "any") {
		return condition.conditions.every((value) =>
			canEvaluateRuleConditionFromRawInput(schema, value, input),
		);
	}
	if (!hasValueAtPath(input, condition.path)) {
		return false;
	}
	const property = getAppPropertyDefinitionAtPath(schema.fields, condition.path);
	if (property === undefined) {
		return false;
	}
	const value = getAppSchemaValueAtPath(input, condition.path);
	const decoded = Schema.decodeUnknownResult(createPropertyValueSchema(property))(value);
	if (Result.isFailure(decoded)) {
		return false;
	}
	return (
		condition.operator === "exists" ||
		condition.operator === "not_exists" ||
		Object.is(decoded.success, value)
	);
};

const collectRequiredPropertyIssues = (
	schema: AppSchema,
	property: AppPropertyDefinition,
	value: unknown,
	path: ReadonlyArray<string>,
	input: PropertyValues,
	requiredRules: ReadonlyArray<AppSchemaRule>,
	schemaAddressable = true,
): ReadonlyArray<PropertyValidationIssue> => {
	if (schemaAddressable && isAppSchemaPathHidden(schema, path, input)) {
		return [];
	}
	const requiredRule = schemaAddressable
		? requiredRules.find((rule) => areAppSchemaPathsEqual(rule.path, path))
		: undefined;
	const declaredRequired = isAppPropertyRequired(property);
	const effectivelyRequired = schemaAddressable
		? isAppSchemaPathEffectivelyRequired(schema, path, input)
		: declaredRequired;
	if (isMissingAppSchemaRequiredValue(value)) {
		if (!effectivelyRequired) {
			return [];
		}
		return [
			{
				path: [...path],
				message:
					requiredRule?.message ??
					(declaredRequired ? "is missing" : `${path.join(".")} is required`),
			},
		];
	}
	if (property.type === "object" && isStringRecord(value)) {
		return Object.entries(property.properties).flatMap(([key, child]) =>
			collectRequiredPropertyIssues(
				schema,
				child,
				value[key],
				[...path, key],
				input,
				requiredRules,
				schemaAddressable,
			),
		);
	}
	if (property.type === "array" && Array.isArray(value)) {
		return value.flatMap((item, index) =>
			collectRequiredPropertyIssues(
				schema,
				property.items,
				item,
				[...path, String(index)],
				input,
				requiredRules,
				false,
			),
		);
	}
	return [];
};

const collectRequiredIssues = (
	schema: AppSchema,
	input: PropertyValues,
	requiredRules: ReadonlyArray<AppSchemaRule>,
) => {
	const issues = Object.entries(schema.fields).flatMap(([key, property]) =>
		collectRequiredPropertyIssues(schema, property, input[key], [key], input, requiredRules),
	);
	for (const rule of requiredRules) {
		if (
			!isAppSchemaPathEffectivelyRequired(schema, rule.path, input) ||
			issues.some((issue) => areAppSchemaPathsEqual(issue.path, rule.path))
		) {
			continue;
		}
		const value = getAppSchemaValueAtPath(input, rule.path);
		if (isMissingAppSchemaRequiredValue(value)) {
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
		if (!Object.hasOwn(value, segment)) {
			return;
		}
		const child = value[segment];
		if (!isStringRecord(child)) {
			return;
		}
		value = child;
	}
	const key = path.at(-1);
	if (key !== undefined && Object.hasOwn(value, key)) {
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

const timeZoneValueSchema = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) => isNamedTimeZone(value) || "Expected an IANA time zone"),
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
		return applyStringValidation(Schema.String, property.validation);
	}
	if (property.format?.kind === "url") {
		return applyStringValidation(HttpUrl, property.validation);
	}
	if (property.format?.kind === "email") {
		return applyStringValidation(Email, property.validation);
	}
	if (property.format?.kind === "timezone") {
		return applyStringValidation(timeZoneValueSchema, property.validation);
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
			encode: SchemaGetter.transform((value) => value),
			decode: SchemaGetter.transform((value) => roundHalfUp(value, normalization.round.scale)),
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
	const shape = Object.fromEntries(
		Object.entries(fields).map(([key, value]) => [key, toStructField(value)]),
	);
	return applyUnknownKeysPolicy(Schema.Struct(shape), unknownKeys);
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

export const decodeAppSchemaPropertyValues = (schema: AppSchema, input: unknown) =>
	Schema.decodeUnknownResult(createPropertiesValueSchema(schema))(input);

export const parseAppSchemaPropertiesSafe = (input: {
	kind?: string;
	properties: unknown;
	propertiesSchema: AppSchema;
	allowedMissingRequiredPaths?: ReadonlyArray<ReadonlyArray<string>>;
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
	const rawVisibilityRules = (input.propertiesSchema.rules ?? []).filter(
		(rule) =>
			rule.kind === "visibility" &&
			canEvaluateRuleConditionFromRawInput(input.propertiesSchema, rule.when, input.properties) &&
			evaluateAppSchemaRuleCondition(rule.when, input.properties),
	);
	const rawHiddenIssues = rawVisibilityRules.flatMap((rule) =>
		hasValueAtPath(input.properties, rule.path)
			? [
					{
						path: [...rule.path],
						message: rule.message ?? `${rule.path.join(".")} must be absent when hidden`,
					},
				]
			: [],
	);
	if (rawHiddenIssues.length > 0) {
		return { success: false, issues: rawHiddenIssues };
	}
	const decoded = decodeAppSchemaPropertyValues(input.propertiesSchema, input.properties);
	if (Result.isFailure(decoded)) {
		return { success: false, issues: parseErrorToIssues(decoded.failure) };
	}
	const activeRules = (input.propertiesSchema.rules ?? []).filter((rule) =>
		evaluateAppSchemaRuleCondition(rule.when, decoded.success),
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
		requiredRules,
	).filter(
		(issue) =>
			!input.allowedMissingRequiredPaths?.some((path) => areAppSchemaPathsEqual(path, issue.path)),
	);
	if (requiredIssues.length > 0) {
		return { success: false, issues: requiredIssues };
	}
	for (const path of hiddenPaths) {
		omitValueAtPath(decoded.success, path);
	}
	return { success: true, data: decoded.success };
};
