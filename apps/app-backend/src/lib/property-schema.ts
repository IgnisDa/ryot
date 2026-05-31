import { Schema } from "effect";

import { strictStruct } from "./schema-utils";

const nonEmptyTrimmedString = Schema.String.pipe(
	Schema.filter((value) => value.trim().length > 0, {
		message: () => "Expected a non-empty string",
	}),
);

const nonNegativeInteger = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0));

const positiveNumber = Schema.Number.pipe(Schema.greaterThan(0));

export const propertySchemaMessage = "Properties must contain at least one property";

export const createPropertySchemaMessage = (label: string) =>
	`${label} must contain at least one property`;

export const appPropertyPrimitiveTypes = [
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
	readonly round?: AppPropertyRoundTransform;
};

export type AppSchemaUnknownKeysPolicy = "strip" | "strict" | "passthrough";

type AppPropertyValidationBase = {
	readonly required?: true;
};

export type AppArrayPropertyValidation = AppPropertyValidationBase & {
	readonly maxItems?: number;
	readonly minItems?: number;
};

export type AppNumberPropertyValidation = AppPropertyValidationBase & {
	readonly maximum?: number;
	readonly minimum?: number;
	readonly multipleOf?: number;
	readonly exclusiveMaximum?: number;
	readonly exclusiveMinimum?: number;
};

export type AppStringPropertyValidation = AppPropertyValidationBase & {
	readonly pattern?: string;
	readonly maxLength?: number;
	readonly minLength?: number;
};

type AppPropertyBase<TValidation> = {
	readonly label: string;
	readonly description: string;
	readonly validation?: TValidation;
	readonly transform?: AppPropertyTransform;
};

export type AppStringProperty = AppPropertyBase<AppStringPropertyValidation> & {
	readonly type: "string";
	readonly defaultValue?: string;
};

export type AppNumberProperty = AppPropertyBase<AppNumberPropertyValidation> & {
	readonly type: "number";
	readonly defaultValue?: number;
};

export type AppIntegerProperty = AppPropertyBase<AppNumberPropertyValidation> & {
	readonly type: "integer";
	readonly defaultValue?: number;
};

export type AppBooleanProperty = AppPropertyBase<AppPropertyValidationBase> & {
	readonly type: "boolean";
	readonly defaultValue?: boolean;
};

export type AppDateProperty = AppPropertyBase<AppPropertyValidationBase> & {
	readonly type: "date";
	readonly defaultValue?: string;
};

export type AppDateTimeProperty = AppPropertyBase<AppPropertyValidationBase> & {
	readonly type: "datetime";
	readonly defaultValue?: string;
};

export type AppEnumProperty = AppPropertyBase<AppPropertyValidationBase> & {
	readonly type: "enum";
	readonly defaultValue?: string;
	readonly options: ReadonlyArray<string>;
};

export type AppEnumArrayProperty = AppPropertyBase<AppArrayPropertyValidation> & {
	readonly type: "enum-array";
	readonly options: ReadonlyArray<string>;
	readonly defaultValue?: ReadonlyArray<string>;
};

export type AppArrayProperty = AppPropertyBase<AppArrayPropertyValidation> & {
	readonly type: "array";
	readonly items: AppPropertyDefinition;
	readonly defaultValue?: ReadonlyArray<unknown>;
};

export type AppObjectProperty = AppPropertyBase<AppPropertyValidationBase> & {
	readonly type: "object";
	readonly properties: AppSchemaFields;
	readonly unknownKeys?: AppSchemaUnknownKeysPolicy;
	readonly defaultValue?: Readonly<Record<string, unknown>>;
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
	readonly message?: string;
	readonly kind: "validation";
	readonly path: AppSchemaRulePath;
	readonly when: AppSchemaRuleCondition;
	readonly validation: { readonly required: true };
};

export type AppSchema = {
	readonly fields: AppSchemaFields;
	readonly rules?: ReadonlyArray<AppSchemaRule>;
	readonly unknownKeys?: AppSchemaUnknownKeysPolicy;
};

export const PropertyValidationIssue = Schema.Struct({
	message: Schema.String,
	path: Schema.Array(Schema.String),
});

export type PropertyValidationIssue = typeof PropertyValidationIssue.Type;

export class PropertyValidationError extends Schema.TaggedError<PropertyValidationError>()(
	"PropertyValidationError",
	{ message: Schema.String, issues: Schema.Array(PropertyValidationIssue) },
) {}

export const AppSchemaUnknownKeysPolicy = Schema.Literal("strip", "strict", "passthrough");

const requiredValidationSchema = strictStruct({ required: Schema.optional(Schema.Literal(true)) });

const hasValidNumericBounds = (value: {
	readonly maximum?: number;
	readonly minimum?: number;
	readonly exclusiveMaximum?: number;
	readonly exclusiveMinimum?: number;
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
	Schema.filter(
		(value) =>
			!(value.minimum !== undefined && value.exclusiveMinimum !== undefined) &&
			!(value.maximum !== undefined && value.exclusiveMaximum !== undefined),
		{
			message: () =>
				"Use either minimum or exclusiveMinimum, and either maximum or exclusiveMaximum",
		},
	),
	Schema.filter(hasValidNumericBounds, {
		message: () => "Lower bounds must be less than upper bounds",
	}),
);

const stringValidationSchema = strictStruct({
	pattern: Schema.optional(
		Schema.String.pipe(
			Schema.filter(
				(value) => {
					try {
						return new RegExp(value) instanceof RegExp;
					} catch {
						return false;
					}
				},
				{ message: () => "Pattern must be a valid regular expression" },
			),
		),
	),
	required: Schema.optional(Schema.Literal(true)),
	maxLength: Schema.optional(nonNegativeInteger),
	minLength: Schema.optional(nonNegativeInteger),
}).pipe(
	Schema.filter(
		(value) =>
			value.minLength === undefined ||
			value.maxLength === undefined ||
			value.minLength <= value.maxLength,
		{ message: () => "minLength must be less than or equal to maxLength" },
	),
);

const arrayValidationSchema = strictStruct({
	maxItems: Schema.optional(nonNegativeInteger),
	minItems: Schema.optional(nonNegativeInteger),
	required: Schema.optional(Schema.Literal(true)),
}).pipe(
	Schema.filter(
		(value) =>
			value.minItems === undefined ||
			value.maxItems === undefined ||
			value.minItems <= value.maxItems,
		{ message: () => "minItems must be less than or equal to maxItems" },
	),
);

const roundTransformSchema = strictStruct({
	scale: nonNegativeInteger,
	mode: Schema.Literal("half_up"),
});

const numberTransformSchema = strictStruct({ round: Schema.optional(roundTransformSchema) });

const rulePathSchema = Schema.Array(nonEmptyTrimmedString).pipe(Schema.minItems(1));

const ruleValueSchema = Schema.Union(Schema.Boolean, Schema.Null, Schema.Number, Schema.String);

const enumOptionsSchema = Schema.Array(nonEmptyTrimmedString).pipe(
	Schema.minItems(1, { message: () => "Expected at least one enum option" }),
);

const propertyBaseFields = {
	label: nonEmptyTrimmedString,
	description: nonEmptyTrimmedString,
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
	defaultValue: Schema.optional(Schema.Number.pipe(Schema.int())),
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

export const AppPropertyDefinition: Schema.Schema<AppPropertyDefinition> = Schema.suspend(() =>
	Schema.Union(
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
		}),
		strictStruct({
			...propertyBaseFields,
			type: Schema.Literal("object"),
			validation: Schema.optional(requiredValidationSchema),
			unknownKeys: Schema.optional(AppSchemaUnknownKeysPolicy),
			properties: Schema.Record({ key: Schema.String, value: AppPropertyDefinition }),
			defaultValue: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
		}),
		strictStruct({
			...propertyBaseFields,
			options: enumOptionsSchema,
			type: Schema.Literal("enum"),
			defaultValue: Schema.optional(Schema.String),
			validation: Schema.optional(requiredValidationSchema),
		}).pipe(
			Schema.filter(
				(value) => value.defaultValue === undefined || value.options.includes(value.defaultValue),
				{ message: () => "defaultValue must be one of the enum options" },
			),
		),
		strictStruct({
			...propertyBaseFields,
			options: enumOptionsSchema,
			type: Schema.Literal("enum-array"),
			validation: Schema.optional(arrayValidationSchema),
			defaultValue: Schema.optional(Schema.Array(Schema.String)),
		}).pipe(
			Schema.filter(
				(value) =>
					value.defaultValue === undefined ||
					value.defaultValue.every((item) => value.options.includes(item)),
				{ message: () => "defaultValue items must be one of the enum options" },
			),
		),
	),
).pipe(
	Schema.annotations({ identifier: "AppPropertyDefinition", title: "App Property Definition" }),
);

const ruleConditionValueSchema = strictStruct({
	path: rulePathSchema,
	value: ruleValueSchema,
	operator: Schema.Literal("eq", "neq"),
});

const ruleConditionExistsSchema = strictStruct({
	path: rulePathSchema,
	operator: Schema.Literal("exists", "not_exists"),
});

const ruleConditionManySchema = strictStruct({
	path: rulePathSchema,
	value: Schema.Array(ruleValueSchema).pipe(Schema.minItems(1)),
	operator: Schema.Literal("in", "not_in"),
});

export const AppSchemaRuleCondition: Schema.Schema<AppSchemaRuleCondition> = Schema.suspend(() =>
	Schema.Union(
		ruleConditionManySchema,
		ruleConditionValueSchema,
		ruleConditionExistsSchema,
		strictStruct({
			operator: Schema.Literal("all", "any"),
			conditions: Schema.Array(AppSchemaRuleCondition).pipe(Schema.minItems(1)),
		}),
	),
).pipe(
	Schema.annotations({ identifier: "AppSchemaRuleCondition", title: "App Schema Rule Condition" }),
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
	fields: Schema.Record({ key: Schema.String, value: AppPropertyDefinition }),
}).pipe(Schema.annotations({ identifier: "AppSchema", title: "App Schema" }));

export const AppSchema: Schema.Schema<AppSchema> = appSchemaBase;

export const propertySchemaTypes = appPropertyPrimitiveTypes;
