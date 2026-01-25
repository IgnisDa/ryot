import { Result, Schema } from "effect";

import { strictStruct } from "./utils";

const nonEmptyTrimmedString = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((schemaFilterInput) =>
			((value) => value.trim().length > 0)(schemaFilterInput),
		),
	),
);

const nonNegativeInteger = Schema.Number.pipe(
	Schema.check(Schema.isInt()),
	Schema.check(Schema.isGreaterThanOrEqualTo(0)),
);

const positiveNumber = Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0)));

export const createPropertySchemaMessage = (label: string) =>
	`${label} must contain at least one property`;

const appPropertyPrimitiveTypes = [
	"string",
	"number",
	"integer",
	"boolean",
	"date",
	"datetime",
] as const;

export type AppPropertyPrimitiveType = (typeof appPropertyPrimitiveTypes)[number];

export type AppSchemaRulePath = ReadonlyArray<string>;

export type AppSchemaRuleValue = boolean | null | number | string;

export type AppPropertyRoundTransform = {
	readonly scale: number;
	readonly mode: "half_up";
};

export type AppPropertyTransform = {
	readonly round?: AppPropertyRoundTransform | undefined;
};

export type AppSchemaUnknownKeysPolicy = "strip" | "strict" | "passthrough";

type AppPropertyValidationBase = {
	readonly required?: true | undefined;
};

export type AppArrayPropertyValidation = AppPropertyValidationBase & {
	readonly maxItems?: number | undefined;
	readonly minItems?: number | undefined;
};

export type AppNumberPropertyValidation = AppPropertyValidationBase & {
	readonly maximum?: number | undefined;
	readonly minimum?: number | undefined;
	readonly multipleOf?: number | undefined;
	readonly exclusiveMaximum?: number | undefined;
	readonly exclusiveMinimum?: number | undefined;
};

export type AppStringPropertyValidation = AppPropertyValidationBase & {
	readonly pattern?: string | undefined;
	readonly maxLength?: number | undefined;
	readonly minLength?: number | undefined;
};

type AppPropertyBase<TValidation> = {
	readonly label: string;
	readonly description: string;
	readonly secret?: true | undefined;
	readonly validation?: TValidation | undefined;
	readonly translatable?: true | undefined;
	readonly transform?: AppPropertyTransform | undefined;
};

export type AppStringProperty = AppPropertyBase<AppStringPropertyValidation> & {
	readonly type: "string";
	readonly defaultValue?: string | undefined;
};

export type AppNumberProperty = AppPropertyBase<AppNumberPropertyValidation> & {
	readonly type: "number";
	readonly defaultValue?: number | undefined;
};

export type AppIntegerProperty = AppPropertyBase<AppNumberPropertyValidation> & {
	readonly type: "integer";
	readonly defaultValue?: number | undefined;
};

export type AppBooleanProperty = AppPropertyBase<AppPropertyValidationBase> & {
	readonly type: "boolean";
	readonly defaultValue?: boolean | undefined;
};

export type AppDateProperty = AppPropertyBase<AppPropertyValidationBase> & {
	readonly type: "date";
	readonly defaultValue?: string | undefined;
};

export type AppDateTimeProperty = AppPropertyBase<AppPropertyValidationBase> & {
	readonly type: "datetime";
	readonly defaultValue?: string | undefined;
};

export type AppEnumProperty = AppPropertyBase<AppPropertyValidationBase> & {
	readonly type: "enum";
	readonly defaultValue?: string | undefined;
	readonly options: ReadonlyArray<string>;
};

export type AppEnumArrayProperty = AppPropertyBase<AppArrayPropertyValidation> & {
	readonly type: "enum-array";
	readonly options: ReadonlyArray<string>;
	readonly defaultValue?: ReadonlyArray<string> | undefined;
};

export type AppArrayProperty = AppPropertyBase<AppArrayPropertyValidation> & {
	readonly type: "array";
	readonly items: AppPropertyDefinition;
	readonly defaultValue?: ReadonlyArray<unknown> | undefined;
};

export type AppObjectProperty = AppPropertyBase<AppPropertyValidationBase> & {
	readonly type: "object";
	readonly properties: AppSchemaFields;
	readonly unknownKeys?: AppSchemaUnknownKeysPolicy | undefined;
	readonly defaultValue?: Readonly<Record<string, unknown>> | undefined;
};

export type AppPropertyDefinition =
	| AppDateProperty
	| AppEnumProperty
	| AppArrayProperty
	| AppNumberProperty
	| AppObjectProperty
	| AppStringProperty
	| AppIntegerProperty
	| AppBooleanProperty
	| AppDateTimeProperty
	| AppEnumArrayProperty;

export type AppSchemaFields = Readonly<Record<string, AppPropertyDefinition>>;

type AppSchemaLeafRuleCondition<T extends string, TValue = never> = {
	readonly operator: T;
	readonly path: AppSchemaRulePath;
} & ([TValue] extends [never] ? object : { readonly value: TValue });

export type AppSchemaRuleCondition =
	| AppSchemaLeafRuleCondition<"exists">
	| AppSchemaLeafRuleCondition<"not_exists">
	| AppSchemaLeafRuleCondition<"eq", AppSchemaRuleValue>
	| AppSchemaLeafRuleCondition<"neq", AppSchemaRuleValue>
	| AppSchemaLeafRuleCondition<"in", ReadonlyArray<AppSchemaRuleValue>>
	| AppSchemaLeafRuleCondition<"not_in", ReadonlyArray<AppSchemaRuleValue>>
	| { readonly operator: "all"; readonly conditions: ReadonlyArray<AppSchemaRuleCondition> }
	| { readonly operator: "any"; readonly conditions: ReadonlyArray<AppSchemaRuleCondition> };

export type AppSchemaRule = {
	readonly message?: string | undefined;
	readonly kind: "validation";
	readonly path: AppSchemaRulePath;
	readonly when: AppSchemaRuleCondition;
	readonly validation: { readonly required: true };
};

export type AppSchema = {
	readonly fields: AppSchemaFields;
	readonly rules?: ReadonlyArray<AppSchemaRule> | undefined;
	readonly unknownKeys?: AppSchemaUnknownKeysPolicy | undefined;
};

const PropertyValidationIssue = Schema.Struct({
	message: Schema.String,
	path: Schema.Array(Schema.String),
});

export type PropertyValidationIssue = typeof PropertyValidationIssue.Type;

export class PropertyValidationError extends Schema.TaggedErrorClass<PropertyValidationError>()(
	"PropertyValidationError",
	{ message: Schema.String, issues: Schema.Array(PropertyValidationIssue) },
) {}

const AppSchemaUnknownKeysPolicy = Schema.Literals(["strip", "strict", "passthrough"]);

const requiredValidationSchema = strictStruct({ required: Schema.optional(Schema.Literal(true)) });

const hasValidNumericBounds = (value: {
	readonly maximum?: number | undefined;
	readonly minimum?: number | undefined;
	readonly exclusiveMaximum?: number | undefined;
	readonly exclusiveMinimum?: number | undefined;
}) => {
	const lower = value.minimum ?? value.exclusiveMinimum;
	const upper = value.maximum ?? value.exclusiveMaximum;
	if (lower === undefined || upper === undefined) {
		return true;
	}
	if (lower < upper) {
		return true;
	}
	if (lower > upper) {
		return false;
	}
	return value.minimum !== undefined && value.maximum !== undefined;
};

const numberValidationSchema = strictStruct({
	maximum: Schema.optional(Schema.Number),
	minimum: Schema.optional(Schema.Number),
	multipleOf: Schema.optional(positiveNumber),
	required: Schema.optional(Schema.Literal(true)),
	exclusiveMaximum: Schema.optional(Schema.Number),
	exclusiveMinimum: Schema.optional(Schema.Number),
}).pipe(
	Schema.check(
		Schema.makeFilter((schemaFilterInput2) =>
			((value) =>
				!(value.minimum !== undefined && value.exclusiveMinimum !== undefined) &&
				!(value.maximum !== undefined && value.exclusiveMaximum !== undefined))(schemaFilterInput2),
		),
	),
	Schema.check(
		Schema.makeFilter((schemaFilterInput3) => hasValidNumericBounds(schemaFilterInput3)),
	),
);

const stringValidationSchema = strictStruct({
	pattern: Schema.optional(
		Schema.String.pipe(
			Schema.check(
				Schema.makeFilter((schemaFilterInput4) =>
					((value) => Result.isSuccess(Result.try(() => new RegExp(value))))(schemaFilterInput4),
				),
			),
		),
	),
	required: Schema.optional(Schema.Literal(true)),
	maxLength: Schema.optional(nonNegativeInteger),
	minLength: Schema.optional(nonNegativeInteger),
}).pipe(
	Schema.check(
		Schema.makeFilter((schemaFilterInput5) =>
			((value) =>
				value.minLength === undefined ||
				value.maxLength === undefined ||
				value.minLength <= value.maxLength)(schemaFilterInput5),
		),
	),
);

const arrayValidationSchema = strictStruct({
	maxItems: Schema.optional(nonNegativeInteger),
	minItems: Schema.optional(nonNegativeInteger),
	required: Schema.optional(Schema.Literal(true)),
}).pipe(
	Schema.check(
		Schema.makeFilter((schemaFilterInput6) =>
			((value) =>
				value.minItems === undefined ||
				value.maxItems === undefined ||
				value.minItems <= value.maxItems)(schemaFilterInput6),
		),
	),
);

const roundTransformSchema = strictStruct({
	scale: nonNegativeInteger,
	mode: Schema.Literal("half_up"),
});

const numberTransformSchema = strictStruct({ round: Schema.optional(roundTransformSchema) });

const rulePathSchema = Schema.Array(nonEmptyTrimmedString).pipe(
	Schema.check(Schema.isMinLength(1)),
);

const ruleValueSchema = Schema.Union([Schema.Boolean, Schema.Null, Schema.Number, Schema.String]);

const enumOptionsSchema = Schema.Array(nonEmptyTrimmedString).pipe(
	Schema.check(Schema.isMinLength(1, { message: "Expected at least one enum option" })),
);

const propertyBaseFields = {
	label: nonEmptyTrimmedString,
	description: nonEmptyTrimmedString,
	secret: Schema.optional(Schema.Literal(true)),
	translatable: Schema.optional(Schema.Literal(true)),
};

const stringPropertySchema = strictStruct({
	...propertyBaseFields,
	type: Schema.Literal("string"),
	defaultValue: Schema.optional(Schema.String),
	validation: Schema.optional(stringValidationSchema),
});

const numberPropertySchema = strictStruct({
	...propertyBaseFields,
	type: Schema.Literal("number"),
	defaultValue: Schema.optional(Schema.Number),
	transform: Schema.optional(numberTransformSchema),
	validation: Schema.optional(numberValidationSchema),
});

const integerPropertySchema = strictStruct({
	...propertyBaseFields,
	type: Schema.Literal("integer"),
	transform: Schema.optional(numberTransformSchema),
	validation: Schema.optional(numberValidationSchema),
	defaultValue: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isInt()))),
});

const booleanPropertySchema = strictStruct({
	...propertyBaseFields,
	type: Schema.Literal("boolean"),
	defaultValue: Schema.optional(Schema.Boolean),
	validation: Schema.optional(requiredValidationSchema),
});

const datePropertySchema = strictStruct({
	...propertyBaseFields,
	type: Schema.Literal("date"),
	defaultValue: Schema.optional(Schema.String),
	validation: Schema.optional(requiredValidationSchema),
});

const datetimePropertySchema = strictStruct({
	...propertyBaseFields,
	type: Schema.Literal("datetime"),
	defaultValue: Schema.optional(Schema.String),
	validation: Schema.optional(requiredValidationSchema),
});

const AppPropertyDefinition: Schema.Codec<AppPropertyDefinition, unknown> = Schema.suspend(() =>
	Schema.Union([
		datePropertySchema,
		numberPropertySchema,
		stringPropertySchema,
		booleanPropertySchema,
		integerPropertySchema,
		datetimePropertySchema,
		strictStruct({
			...propertyBaseFields,
			items: AppPropertyDefinition,
			type: Schema.Literal("array"),
			validation: Schema.optional(arrayValidationSchema),
			defaultValue: Schema.optional(Schema.Array(Schema.Unknown)),
		}).pipe(
			Schema.annotate({
				identifier: "ArrayPropertyDefinition",
				title: "Array Property Definition",
			}),
		),
		strictStruct({
			...propertyBaseFields,
			type: Schema.Literal("object"),
			validation: Schema.optional(requiredValidationSchema),
			unknownKeys: Schema.optional(AppSchemaUnknownKeysPolicy),
			properties: Schema.Record(Schema.String, AppPropertyDefinition),
			defaultValue: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
		}).pipe(
			Schema.annotate({
				identifier: "ObjectPropertyDefinition",
				title: "Object Property Definition",
			}),
		),
		strictStruct({
			...propertyBaseFields,
			options: enumOptionsSchema,
			type: Schema.Literal("enum"),
			defaultValue: Schema.optional(Schema.String),
			validation: Schema.optional(requiredValidationSchema),
		}).pipe(
			Schema.check(
				Schema.makeFilter((schemaFilterInput7) =>
					((value) =>
						value.defaultValue === undefined || value.options.includes(value.defaultValue))(
						schemaFilterInput7,
					),
				),
			),
			Schema.annotate({ title: "Enum Property Definition", identifier: "EnumPropertyDefinition" }),
		),
		strictStruct({
			...propertyBaseFields,
			options: enumOptionsSchema,
			type: Schema.Literal("enum-array"),
			validation: Schema.optional(arrayValidationSchema),
			defaultValue: Schema.optional(Schema.Array(Schema.String)),
		}).pipe(
			Schema.check(
				Schema.makeFilter((schemaFilterInput8) =>
					((value) =>
						value.defaultValue === undefined ||
						value.defaultValue.every((item) => value.options.includes(item)))(schemaFilterInput8),
				),
			),
			Schema.annotate({
				title: "Enum Array Property Definition",
				identifier: "EnumArrayPropertyDefinition",
			}),
		),
	]),
).pipe(Schema.annotate({ identifier: "AppPropertyDefinition", title: "App Property Definition" }));

const ruleConditionValueSchema = strictStruct({
	path: rulePathSchema,
	value: ruleValueSchema,
	operator: Schema.Literals(["eq", "neq"]),
});

const ruleConditionExistsSchema = strictStruct({
	path: rulePathSchema,
	operator: Schema.Literals(["exists", "not_exists"]),
});

const ruleConditionManySchema = strictStruct({
	path: rulePathSchema,
	operator: Schema.Literals(["in", "not_in"]),
	value: Schema.Array(ruleValueSchema).pipe(Schema.check(Schema.isMinLength(1))),
});

const AppSchemaRuleCondition: Schema.Codec<AppSchemaRuleCondition, unknown> = Schema.suspend(() =>
	Schema.Union([
		ruleConditionManySchema,
		ruleConditionValueSchema,
		ruleConditionExistsSchema,
		strictStruct({
			operator: Schema.Literals(["all", "any"]),
			conditions: Schema.Array(AppSchemaRuleCondition).pipe(Schema.check(Schema.isMinLength(1))),
		}).pipe(
			Schema.annotate({ identifier: "CombinedRuleCondition", title: "Combined Rule Condition" }),
		),
	]),
).pipe(
	Schema.annotate({ identifier: "AppSchemaRuleCondition", title: "App Schema Rule Condition" }),
);

const AppSchemaRule = strictStruct({
	path: rulePathSchema,
	when: AppSchemaRuleCondition,
	kind: Schema.Literal("validation"),
	message: Schema.optional(nonEmptyTrimmedString),
	validation: strictStruct({ required: Schema.Literal(true) }),
});

const appSchemaBase = strictStruct({
	unknownKeys: Schema.optional(AppSchemaUnknownKeysPolicy),
	rules: Schema.optional(Schema.Array(AppSchemaRule)),
	fields: Schema.Record(Schema.String, AppPropertyDefinition),
}).pipe(Schema.annotate({ identifier: "AppSchema", title: "App Schema" }));

export const AppSchema: Schema.Codec<AppSchema, unknown> = appSchemaBase;

/**
 * Returns the top-level property keys a schema declares as translatable. These are
 * the only properties a translation overlay is allowed to localize; everything else
 * (genres, runtimes, dates, ...) always renders in the canonical language.
 */
export const collectTranslatableProperties = (schema: AppSchema): ReadonlyArray<string> =>
	Object.entries(schema.fields).flatMap(([key, definition]) =>
		definition.translatable === true ? [key] : [],
	);

/**
 * Returns the top-level property keys a schema declares as secret. These carry
 * credentials, so the client renders them as password inputs and the kernel redacts
 * them when handing a stored value back.
 */
export const collectSecretProperties = (schema: AppSchema): ReadonlyArray<string> =>
	Object.entries(schema.fields).flatMap(([key, definition]) =>
		definition.secret === true ? [key] : [],
	);
