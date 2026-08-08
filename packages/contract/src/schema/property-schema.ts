import { Result, Schema } from "effect";

import { strictStruct } from "./utils";

const nonEmptyTrimmedString = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => value.trim().length > 0)),
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

export type AppPropertyRoundNormalization = {
	readonly scale: number;
};

export type AppPropertyNormalization = {
	readonly round: AppPropertyRoundNormalization;
};

export type AppSchemaUnknownKeysPolicy = "strip" | "strict" | "passthrough";

type AppPropertyValidationBase = {
	readonly required?: true | undefined;
};

type AppObjectPropertyValidation = AppPropertyValidationBase & {
	readonly asset?: true | undefined;
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
	readonly position?: number | undefined;
	readonly translatable?: true | undefined;
	readonly validation?: TValidation | undefined;
};

export type AppStringPropertyFormat =
	| { readonly kind: "url" }
	| { readonly kind: "email" }
	| { readonly kind: "upload"; readonly allowedFileExtensions: ReadonlyArray<string> };

export type AppStringProperty = AppPropertyBase<AppStringPropertyValidation> & {
	readonly type: "string";
	readonly defaultValue?: string | undefined;
	readonly format?: AppStringPropertyFormat | undefined;
};

export type AppNumberProperty = AppPropertyBase<AppNumberPropertyValidation> & {
	readonly type: "number";
	readonly defaultValue?: number | undefined;
	readonly normalize?: AppPropertyNormalization | undefined;
};

export type AppIntegerProperty = AppPropertyBase<AppNumberPropertyValidation> & {
	readonly type: "integer";
	readonly defaultValue?: number | undefined;
	readonly normalize?: AppPropertyNormalization | undefined;
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

export type AppChoice = {
	readonly value: string;
	readonly label?: string | undefined;
};

export type AppChoices =
	| { readonly kind: "dynamic"; readonly source: string }
	| { readonly kind: "static"; readonly values: ReadonlyArray<AppChoice> };

export type AppEnumProperty = AppPropertyBase<AppPropertyValidationBase> & {
	readonly type: "enum";
	readonly choices: AppChoices;
	readonly defaultValue?: string | undefined;
};

export type AppEnumArrayProperty = AppPropertyBase<AppArrayPropertyValidation> & {
	readonly type: "enum-array";
	readonly choices: AppChoices;
	readonly defaultValue?: ReadonlyArray<string> | undefined;
};

export type AppArrayProperty = AppPropertyBase<AppArrayPropertyValidation> & {
	readonly type: "array";
	readonly items: AppPropertyDefinition;
	readonly defaultValue?: ReadonlyArray<unknown> | undefined;
};

export type AppObjectProperty = AppPropertyBase<AppObjectPropertyValidation> & {
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

type AppSchemaRuleBase = {
	readonly path: AppSchemaRulePath;
	readonly when: AppSchemaRuleCondition;
	readonly message?: string | undefined;
};

export type AppSchemaRule = AppSchemaRuleBase &
	(
		| { readonly kind: "validation"; readonly validation: { readonly required: true } }
		| { readonly kind: "visibility"; readonly visibility: { readonly hidden: true } }
	);

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

export class PropertyValidationError extends Schema.TaggedError<PropertyValidationError>()(
	"PropertyValidationError",
	{ message: Schema.String, issues: Schema.Array(PropertyValidationIssue) },
) {}

const AppSchemaUnknownKeysPolicy = Schema.Literals(["strip", "strict", "passthrough"]);

const requiredValidationSchema = strictStruct({ required: Schema.optional(Schema.Literal(true)) });

const objectValidationSchema = strictStruct({
	asset: Schema.optional(Schema.Literal(true)),
	required: Schema.optional(Schema.Literal(true)),
});

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
		Schema.makeFilter(
			(value) =>
				!(value.minimum !== undefined && value.exclusiveMinimum !== undefined) &&
				!(value.maximum !== undefined && value.exclusiveMaximum !== undefined),
		),
	),
	Schema.check(Schema.makeFilter(hasValidNumericBounds)),
);

const stringValidationSchema = strictStruct({
	pattern: Schema.optional(
		Schema.String.pipe(
			Schema.check(
				Schema.makeFilter((value) => Result.isSuccess(Result.try(() => new RegExp(value)))),
			),
		),
	),
	required: Schema.optional(Schema.Literal(true)),
	maxLength: Schema.optional(nonNegativeInteger),
	minLength: Schema.optional(nonNegativeInteger),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				value.minLength === undefined ||
				value.maxLength === undefined ||
				value.minLength <= value.maxLength,
		),
	),
);

const arrayValidationSchema = strictStruct({
	maxItems: Schema.optional(nonNegativeInteger),
	minItems: Schema.optional(nonNegativeInteger),
	required: Schema.optional(Schema.Literal(true)),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				value.minItems === undefined ||
				value.maxItems === undefined ||
				value.minItems <= value.maxItems,
		),
	),
);

const roundNormalizationSchema = strictStruct({ scale: nonNegativeInteger });

const numberNormalizationSchema = strictStruct({
	round: roundNormalizationSchema,
});

const rulePathSchema = Schema.Array(nonEmptyTrimmedString).pipe(
	Schema.check(Schema.isMinLength(1)),
);

const ruleValueSchema = Schema.Union([Schema.Boolean, Schema.Null, Schema.Number, Schema.String]);

const propertyBaseFields = {
	label: nonEmptyTrimmedString,
	description: nonEmptyTrimmedString,
	position: Schema.optional(Schema.Finite),
	secret: Schema.optional(Schema.Literal(true)),
	translatable: Schema.optional(Schema.Literal(true)),
};

const fileExtensionSchema = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) => {
			if (value.length === 0 || value !== value.trim()) {
				return "Expected a non-empty trimmed file extension";
			}
			if (value !== value.toLowerCase() || value.startsWith(".")) {
				return "Expected a lower-case file extension without a leading dot";
			}
			return true;
		}),
	),
);

const stringPropertyFormatSchema = Schema.Union([
	strictStruct({ kind: Schema.Literal("url") }),
	strictStruct({ kind: Schema.Literal("email") }),
	strictStruct({
		kind: Schema.Literal("upload"),
		allowedFileExtensions: Schema.Array(fileExtensionSchema).pipe(
			Schema.check(Schema.isMinLength(1)),
			Schema.check(
				Schema.makeFilter((extensions) => new Set(extensions).size === extensions.length),
			),
		),
	}),
]);

export const AppChoiceSchema = strictStruct({
	value: nonEmptyTrimmedString,
	label: Schema.optional(nonEmptyTrimmedString),
});

const staticAppChoicesSchema = strictStruct({
	kind: Schema.Literal("static"),
	values: Schema.Array(AppChoiceSchema).pipe(
		Schema.check(Schema.isMinLength(1, { message: "Expected at least one static choice" })),
		Schema.check(
			Schema.makeFilter(
				(values) =>
					new Set(values.map((choice) => choice.value)).size === values.length ||
					"Expected unique static choice values",
			),
		),
	),
});

const dynamicAppChoicesSchema = strictStruct({
	source: nonEmptyTrimmedString,
	kind: Schema.Literal("dynamic"),
});

const appChoicesSchema = Schema.Union([staticAppChoicesSchema, dynamicAppChoicesSchema]);

const staticEnumDefaultIsValid = (value: {
	readonly choices: AppChoices;
	readonly defaultValue?: string | undefined;
}) =>
	value.choices.kind === "dynamic"
		? value.defaultValue === undefined
		: value.defaultValue === undefined ||
			value.choices.values.some((choice) => choice.value === value.defaultValue);

const staticEnumArrayDefaultIsValid = (value: {
	readonly choices: AppChoices;
	readonly defaultValue?: ReadonlyArray<string> | undefined;
}) => {
	const choices = value.choices;
	if (choices.kind === "dynamic") {
		return value.defaultValue === undefined;
	}
	return (
		value.defaultValue === undefined ||
		value.defaultValue.every((item) => choices.values.some((choice) => choice.value === item))
	);
};

const enumChoicesMaterializationIssue = (
	path: ReadonlyArray<string>,
	source: string,
	message: string,
) => ({ message, path, source });

export type AppSchemaChoicesMaterializationIssue = ReturnType<
	typeof enumChoicesMaterializationIssue
>;

const materializePropertyChoices = (
	property: AppPropertyDefinition,
	path: ReadonlyArray<string>,
	sources: Readonly<Record<string, ReadonlyArray<AppChoice>>>,
	issues: Array<AppSchemaChoicesMaterializationIssue>,
): AppPropertyDefinition => {
	if (property.type === "enum" || property.type === "enum-array") {
		if (property.choices.kind === "static") {
			return property;
		}
		const sourceValues = sources[property.choices.source];
		const sourceLabel = `Choice source '${property.choices.source}' for field '${path.join(".")}'`;
		if (sourceValues === undefined) {
			issues.push(
				enumChoicesMaterializationIssue(
					["fields", ...path, "choices", "source"],
					property.choices.source,
					`${sourceLabel} was not provided`,
				),
			);
			return property;
		}
		const decoded = Schema.decodeUnknownResult(staticAppChoicesSchema)({
			kind: "static",
			values: sourceValues,
		});
		if (Result.isFailure(decoded)) {
			issues.push(
				enumChoicesMaterializationIssue(
					["fields", ...path, "choices", "values"],
					property.choices.source,
					`${sourceLabel} contains invalid or duplicate choice values`,
				),
			);
			return property;
		}
		return { ...property, choices: decoded.success };
	}
	if (property.type === "array") {
		return {
			...property,
			items: materializePropertyChoices(property.items, [...path, "items"], sources, issues),
		};
	}
	if (property.type === "object") {
		return {
			...property,
			properties: Object.fromEntries(
				Object.entries(property.properties).map(([key, value]) => [
					key,
					materializePropertyChoices(value, [...path, key], sources, issues),
				]),
			),
		};
	}
	return property;
};

export const materializeAppSchemaChoices = (
	schema: AppSchema,
	sources: Readonly<Record<string, ReadonlyArray<AppChoice>>>,
) => {
	const issues: Array<AppSchemaChoicesMaterializationIssue> = [];
	const fields = Object.fromEntries(
		Object.entries(schema.fields).map(([key, property]) => [
			key,
			materializePropertyChoices(property, [key], sources, issues),
		]),
	);
	return issues.length > 0 ? Result.fail(issues) : Result.succeed({ ...schema, fields });
};

const enumPropertySchema = strictStruct({
	...propertyBaseFields,
	choices: appChoicesSchema,
	type: Schema.Literal("enum"),
	defaultValue: Schema.optional(Schema.String),
	validation: Schema.optional(requiredValidationSchema),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(value) => staticEnumDefaultIsValid(value) || "Enum defaults must match static choices",
		),
	),
);

const enumArrayPropertySchema = strictStruct({
	...propertyBaseFields,
	choices: appChoicesSchema,
	type: Schema.Literal("enum-array"),
	validation: Schema.optional(arrayValidationSchema),
	defaultValue: Schema.optional(Schema.Array(Schema.String)),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				staticEnumArrayDefaultIsValid(value) || "Enum array defaults must match static choices",
		),
	),
);

const stringPropertySchema = strictStruct({
	...propertyBaseFields,
	type: Schema.Literal("string"),
	format: Schema.optional(stringPropertyFormatSchema),
	defaultValue: Schema.optional(Schema.String),
	validation: Schema.optional(stringValidationSchema),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				value.format?.kind !== "upload" ||
				value.defaultValue === undefined ||
				"Upload string properties cannot define a default value",
		),
	),
);

const numberPropertySchema = strictStruct({
	...propertyBaseFields,
	type: Schema.Literal("number"),
	defaultValue: Schema.optional(Schema.Number),
	normalize: Schema.optional(numberNormalizationSchema),
	validation: Schema.optional(numberValidationSchema),
});

const integerPropertySchema = strictStruct({
	...propertyBaseFields,
	type: Schema.Literal("integer"),
	normalize: Schema.optional(numberNormalizationSchema),
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
			validation: Schema.optional(objectValidationSchema),
			unknownKeys: Schema.optional(AppSchemaUnknownKeysPolicy),
			properties: Schema.Record(Schema.String, AppPropertyDefinition),
			defaultValue: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
		}).pipe(
			Schema.annotate({
				identifier: "ObjectPropertyDefinition",
				title: "Object Property Definition",
			}),
		),
		enumPropertySchema.pipe(
			Schema.annotate({ title: "Enum Property Definition", identifier: "EnumPropertyDefinition" }),
		),
		enumArrayPropertySchema.pipe(
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

const appSchemaRuleFields = {
	path: rulePathSchema,
	when: AppSchemaRuleCondition,
	message: Schema.optional(nonEmptyTrimmedString),
};

const AppSchemaRule = Schema.Union([
	strictStruct({
		...appSchemaRuleFields,
		kind: Schema.Literal("validation"),
		validation: strictStruct({ required: Schema.Literal(true) }),
	}),
	strictStruct({
		...appSchemaRuleFields,
		kind: Schema.Literal("visibility"),
		visibility: strictStruct({ hidden: Schema.Literal(true) }),
	}),
]);

const appSchemaBase = strictStruct({
	unknownKeys: Schema.optional(AppSchemaUnknownKeysPolicy),
	rules: Schema.optional(Schema.Array(AppSchemaRule)),
	fields: Schema.Record(Schema.String, AppPropertyDefinition),
}).pipe(Schema.annotate({ identifier: "AppSchema", title: "App Schema" }));

export const AppSchema: Schema.Codec<AppSchema, unknown> = appSchemaBase;

export const getOrderedAppSchemaFieldEntries = (fields: AppSchemaFields) =>
	Object.entries(fields)
		.map(([key, property], declarationOrder) => ({
			property,
			declarationOrder,
			entry: [key, property] as const,
		}))
		.sort((left, right) => {
			if (left.property.position === undefined) {
				return right.property.position === undefined
					? left.declarationOrder - right.declarationOrder
					: 1;
			}
			if (right.property.position === undefined) {
				return -1;
			}
			return (
				left.property.position - right.property.position ||
				left.declarationOrder - right.declarationOrder
			);
		})
		.map(({ entry }) => entry);

/**
 * Returns whether a property must be present in a payload, as declared by its
 * `validation.required` flag.
 */
export const isAppPropertyRequired = (property: AppPropertyDefinition) =>
	property.validation?.required === true;

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
