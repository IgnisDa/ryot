import { type DisplayText, Message } from "@ryot-app/i18n/message";
import { Result, Schema } from "effect";

import { Entitlement } from "./entitlement";
import { JsonValue } from "./json";
import { strictStruct } from "./utils";

const nonEmptyTrimmedString = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => value.trim().length > 0)),
);

const nonNegativeInteger = Schema.Number.pipe(
	Schema.check(Schema.isInt()),
	Schema.check(Schema.isGreaterThanOrEqualTo(0)),
);

const positiveNumber = Schema.Finite.pipe(Schema.check(Schema.isGreaterThan(0)));

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

export type AppSchemaRulePath = ReadonlyArray<string>;

export type AppSchemaRuleValue = null | number | string | boolean;

export type AppPropertyRoundNormalization = { readonly scale: number };

export type AppSchemaUnknownKeysPolicy = "strip" | "strict" | "passthrough";

export type AppPropertyPrimitiveType = (typeof appPropertyPrimitiveTypes)[number];

export type AppPropertyNormalization = { readonly round: AppPropertyRoundNormalization };

export type AppSchemaFields<Text = DisplayText> = Readonly<
	Record<string, AppPropertyDefinition<Text>>
>;

export type AppArrayPropertyValidation = AppPropertyValidationBase & {
	readonly maxItems?: number | undefined;
	readonly minItems?: number | undefined;
};

export type AppStringPropertyReference = {
	readonly required?: true | undefined;
	readonly kind: "event-id" | "entity-id" | "entity-source" | "relationship-id";
};

export type AppDateProperty<Text = DisplayText> = AppPropertyBase<
	AppPropertyValidationBase,
	Text
> & { readonly type: "date"; readonly defaultValue?: string | undefined };

export type AppBooleanProperty<Text = DisplayText> = AppPropertyBase<
	AppPropertyValidationBase,
	Text
> & { readonly type: "boolean"; readonly defaultValue?: boolean | undefined };

export type AppChoices<Text = DisplayText> =
	| { readonly source: string; readonly kind: "dynamic" }
	| { readonly kind: "static"; readonly values: ReadonlyArray<AppChoice<Text>> };

export type AppDateTimeProperty<Text = DisplayText> = AppPropertyBase<
	AppPropertyValidationBase,
	Text
> & { readonly type: "datetime"; readonly defaultValue?: string | undefined };

export type AppStringPropertyValidation = AppPropertyValidationBase & {
	readonly pattern?: string | undefined;
	readonly maxLength?: number | undefined;
	readonly minLength?: number | undefined;
};

export type AppSchema<Text = DisplayText> = {
	readonly fields: AppSchemaFields<Text>;
	readonly rules?: undefined | ReadonlyArray<AppSchemaRule>;
	readonly unknownKeys?: undefined | AppSchemaUnknownKeysPolicy;
};

export type AppEnumProperty<Text = DisplayText> = AppPropertyBase<
	AppPropertyValidationBase,
	Text
> & {
	readonly type: "enum";
	readonly choices: AppChoices<Text>;
	readonly defaultValue?: string | undefined;
};

export type AppSchemaRule = AppSchemaRuleBase &
	(
		| { readonly kind: "visibility"; readonly visibility: { readonly hidden: true } }
		| { readonly kind: "validation"; readonly validation: { readonly required: true } }
	);

export type AppEnumArrayProperty<Text = DisplayText> = AppPropertyBase<
	AppArrayPropertyValidation,
	Text
> & {
	readonly type: "enum-array";
	readonly choices: AppChoices<Text>;
	readonly defaultValue?: undefined | ReadonlyArray<string>;
};

export type AppArrayProperty<Text = DisplayText> = AppPropertyBase<
	AppArrayPropertyValidation,
	Text
> & {
	readonly type: "array";
	readonly items: AppPropertyDefinition<Text>;
	readonly defaultValue?: undefined | ReadonlyArray<unknown>;
};

export type AppNumberProperty<Text = DisplayText> = AppPropertyBase<
	AppNumberPropertyValidation,
	Text
> & {
	readonly type: "number";
	readonly defaultValue?: number | undefined;
	readonly normalize?: undefined | AppPropertyNormalization;
};

export type AppIntegerProperty<Text = DisplayText> = AppPropertyBase<
	AppNumberPropertyValidation,
	Text
> & {
	readonly type: "integer";
	readonly defaultValue?: number | undefined;
	readonly normalize?: undefined | AppPropertyNormalization;
};

/**
 * A `region` choice has no `label`: its `value` is an ISO 3166-1 alpha-2 or UN M49 region code,
 * and clients label it with the region's name in the viewer's locale.
 */
export type AppChoice<Text = DisplayText> = {
	readonly value: string;
	readonly label?: Text | undefined;
	readonly kind?: "region" | undefined;
	readonly entitlement?: undefined | Entitlement;
	readonly implies?: undefined | Readonly<Record<string, JsonValue>>;
};

export type AppStringPropertyFormat =
	| { readonly kind: "url" }
	| { readonly kind: "email" }
	| { readonly kind: "timezone" }
	| { readonly provider: string; readonly kind: "oauth-connection" }
	| { readonly kind: "upload"; readonly allowedFileExtensions: ReadonlyArray<string> };

export type AppNumberPropertyValidation = AppPropertyValidationBase & {
	readonly maximum?: number | undefined;
	readonly minimum?: number | undefined;
	readonly multipleOf?: number | undefined;
	readonly exclusiveMaximum?: number | undefined;
	readonly exclusiveMinimum?: number | undefined;
};

export type AppStringProperty<Text = DisplayText> = AppPropertyBase<
	AppStringPropertyValidation,
	Text
> & {
	readonly type: "string";
	readonly defaultValue?: string | undefined;
	readonly format?: undefined | AppStringPropertyFormat;
	readonly reference?: undefined | AppStringPropertyReference;
};

export type AppObjectProperty<Text = DisplayText> = AppPropertyBase<
	AppObjectPropertyValidation,
	Text
> & {
	readonly type: "object";
	readonly properties: AppSchemaFields<Text>;
	readonly unknownKeys?: undefined | AppSchemaUnknownKeysPolicy;
	readonly defaultValue?: undefined | Readonly<Record<string, unknown>>;
};

export type AppPropertyDefinition<Text = DisplayText> =
	| AppDateProperty<Text>
	| AppEnumProperty<Text>
	| AppArrayProperty<Text>
	| AppNumberProperty<Text>
	| AppObjectProperty<Text>
	| AppStringProperty<Text>
	| AppIntegerProperty<Text>
	| AppBooleanProperty<Text>
	| AppDateTimeProperty<Text>
	| AppEnumArrayProperty<Text>;

export type AppSchemaRuleCondition =
	| AppSchemaLeafRuleCondition<"exists">
	| AppSchemaLeafRuleCondition<"not_exists">
	| AppSchemaLeafRuleCondition<"eq", AppSchemaRuleValue>
	| AppSchemaLeafRuleCondition<"neq", AppSchemaRuleValue>
	| AppSchemaLeafRuleCondition<"in", ReadonlyArray<AppSchemaRuleValue>>
	| AppSchemaLeafRuleCondition<"not_in", ReadonlyArray<AppSchemaRuleValue>>
	| { readonly operator: "all"; readonly conditions: ReadonlyArray<AppSchemaRuleCondition> }
	| { readonly operator: "any"; readonly conditions: ReadonlyArray<AppSchemaRuleCondition> };

type AppPropertyValidationBase = { readonly required?: true | undefined };

type AppObjectPropertyValidation = AppPropertyValidationBase & {
	readonly asset?: true | undefined;
};

type AppSchemaRuleBase = {
	readonly path: AppSchemaRulePath;
	readonly when: AppSchemaRuleCondition;
	readonly message?: string | undefined;
};

type AppSchemaLeafRuleCondition<T extends string, TValue = never> = {
	readonly operator: T;
	readonly path: AppSchemaRulePath;
} & ([TValue] extends [never] ? object : { readonly value: TValue });

/**
 * `label` and `hint` are display text; `description` documents the field in English for models and
 * developers.
 */
type AppPropertyBase<TValidation, Text> = {
	readonly label: Text;
	readonly description: string;
	readonly hint?: Text | undefined;
	readonly secret?: true | undefined;
	readonly immutable?: true | undefined;
	readonly position?: number | undefined;
	readonly translatable?: true | undefined;
	readonly validation?: undefined | TValidation;
};

export const PropertyValidationIssue = Schema.Struct({
	message: Schema.String,
	path: Schema.Array(Schema.String),
});

export type PropertyValidationIssue = typeof PropertyValidationIssue.Type;

export class PropertyValidationError extends Schema.TaggedError<
	PropertyValidationError,
	{ readonly brand: unique symbol }
>()("PropertyValidationError", {
	message: Schema.String,
	issues: Schema.Array(PropertyValidationIssue),
}) {}

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
	maximum: Schema.optional(Schema.Finite),
	minimum: Schema.optional(Schema.Finite),
	multipleOf: Schema.optional(positiveNumber),
	required: Schema.optional(Schema.Literal(true)),
	exclusiveMaximum: Schema.optional(Schema.Finite),
	exclusiveMinimum: Schema.optional(Schema.Finite),
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
	maxLength: Schema.optional(nonNegativeInteger),
	minLength: Schema.optional(nonNegativeInteger),
	required: Schema.optional(Schema.Literal(true)),
	pattern: Schema.optional(
		Schema.String.pipe(
			Schema.check(
				Schema.makeFilter((value) => Result.isSuccess(Result.try(() => new RegExp(value)))),
			),
		),
	),
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

const numberNormalizationSchema = strictStruct({ round: roundNormalizationSchema });

const rulePathSchema = Schema.Array(nonEmptyTrimmedString).pipe(
	Schema.check(Schema.isMinLength(1)),
);

const ruleValueSchema = Schema.Union([Schema.Boolean, Schema.Null, Schema.Finite, Schema.String]);

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
	strictStruct({ kind: Schema.Literal("timezone") }),
	strictStruct({
		kind: Schema.Literal("upload"),
		allowedFileExtensions: Schema.Array(fileExtensionSchema).pipe(
			Schema.check(Schema.isMinLength(1)),
			Schema.check(
				Schema.makeFilter((extensions) => new Set(extensions).size === extensions.length),
			),
		),
	}),
	strictStruct({ provider: nonEmptyTrimmedString, kind: Schema.Literal("oauth-connection") }),
]);

const stringPropertyReferenceSchema = strictStruct({
	required: Schema.optional(Schema.Literal(true)),
	kind: Schema.Literals(["entity-id", "relationship-id", "event-id", "entity-source"]),
});

const dynamicAppChoicesSchema = strictStruct({
	source: nonEmptyTrimmedString,
	kind: Schema.Literal("dynamic"),
});

const staticEnumDefaultIsValid = (value: {
	readonly choices: AppChoices<unknown>;
	readonly defaultValue?: string | undefined;
}) =>
	value.choices.kind === "dynamic"
		? value.defaultValue === undefined
		: value.defaultValue === undefined ||
			value.choices.values.some((choice) => choice.value === value.defaultValue);

const staticEnumArrayDefaultIsValid = (value: {
	readonly choices: AppChoices<unknown>;
	readonly defaultValue?: undefined | ReadonlyArray<string>;
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
) => ({ path, source, message });

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
		const decoded = Schema.decodeResult(displayTextCodecs.staticAppChoicesSchema)({
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
			Schema.annotate({ title: "Combined Rule Condition", identifier: "CombinedRuleCondition" }),
		),
	]),
).pipe(
	Schema.annotate({ title: "App Schema Rule Condition", identifier: "AppSchemaRuleCondition" }),
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

const hasNestedImmutable = (property: AppPropertyDefinition<unknown>): boolean => {
	if (property.type === "object") {
		return Object.values(property.properties).some(
			(child) => child.immutable === true || hasNestedImmutable(child),
		);
	}
	return (
		property.type === "array" &&
		(property.items.immutable === true || hasNestedImmutable(property.items))
	);
};

const appSchemaCodecs = <Text>(text: Schema.Codec<Text, unknown>) => {
	const propertyBaseFields = {
		label: text,
		hint: Schema.optional(text),
		description: nonEmptyTrimmedString,
		position: Schema.optional(Schema.Finite),
		secret: Schema.optional(Schema.Literal(true)),
		immutable: Schema.optional(Schema.Literal(true)),
		translatable: Schema.optional(Schema.Literal(true)),
	};

	const AppChoiceSchema = strictStruct({
		value: nonEmptyTrimmedString,
		label: Schema.optional(text),
		entitlement: Schema.optional(Entitlement),
		kind: Schema.optional(Schema.Literal("region")),
		implies: Schema.optional(Schema.Record(Schema.String, JsonValue)),
	}).pipe(
		Schema.check(
			Schema.makeFilter(
				(choice) =>
					choice.kind !== "region" ||
					(choice.label === undefined && /^(?:[A-Z]{2}|\d{3})$/.test(choice.value)) ||
					"Region choices take a region code value and no label",
			),
		),
	);

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

	const appChoicesSchema = Schema.Union([staticAppChoicesSchema, dynamicAppChoicesSchema]);

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
		defaultValue: Schema.optional(Schema.String),
		validation: Schema.optional(stringValidationSchema),
		format: Schema.optional(stringPropertyFormatSchema),
		reference: Schema.optional(stringPropertyReferenceSchema),
	}).pipe(
		Schema.check(
			Schema.makeFilter(
				(value) =>
					value.format?.kind !== "upload" ||
					value.defaultValue === undefined ||
					"Upload string properties cannot define a default value",
			),
		),
		Schema.check(
			Schema.makeFilter(
				(value) =>
					value.format?.kind !== "oauth-connection" ||
					value.defaultValue === undefined ||
					"OAuth connection string properties cannot define a default value",
			),
		),
	);

	const numberPropertySchema = strictStruct({
		...propertyBaseFields,
		type: Schema.Literal("number"),
		defaultValue: Schema.optional(Schema.Finite),
		validation: Schema.optional(numberValidationSchema),
		normalize: Schema.optional(numberNormalizationSchema),
	});

	const integerPropertySchema = strictStruct({
		...propertyBaseFields,
		type: Schema.Literal("integer"),
		validation: Schema.optional(numberValidationSchema),
		normalize: Schema.optional(numberNormalizationSchema),
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

	const AppPropertyDefinition: Schema.Codec<AppPropertyDefinition<Text>, unknown> = Schema.suspend(
		() =>
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
						title: "Array Property Definition",
						identifier: "ArrayPropertyDefinition",
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
						title: "Object Property Definition",
						identifier: "ObjectPropertyDefinition",
					}),
				),
				enumPropertySchema.pipe(
					Schema.annotate({
						title: "Enum Property Definition",
						identifier: "EnumPropertyDefinition",
					}),
				),
				enumArrayPropertySchema.pipe(
					Schema.annotate({
						title: "Enum Array Property Definition",
						identifier: "EnumArrayPropertyDefinition",
					}),
				),
			]),
	).pipe(
		Schema.annotate({ title: "App Property Definition", identifier: "AppPropertyDefinition" }),
	);

	const appSchemaBase = strictStruct({
		rules: Schema.optional(Schema.Array(AppSchemaRule)),
		unknownKeys: Schema.optional(AppSchemaUnknownKeysPolicy),
		fields: Schema.Record(Schema.String, AppPropertyDefinition),
	}).pipe(
		Schema.check(
			Schema.makeFilter(
				(schema) =>
					!Object.values(schema.fields).some(hasNestedImmutable) ||
					"Only top-level properties can be immutable",
			),
		),
		Schema.annotate({ title: "App Schema", identifier: "AppSchema" }),
	);

	const schema: Schema.Codec<AppSchema<Text>, unknown> = appSchemaBase;
	return { AppSchema: schema, staticAppChoicesSchema };
};

/** Builds the AppSchema codec for a display text representation, such as manifest text. */
export const appSchemaCodec = <Text>(text: Schema.Codec<Text, unknown>) =>
	appSchemaCodecs(text).AppSchema;

const displayTextCodecs = appSchemaCodecs(Schema.Union([Message, nonEmptyTrimmedString]));

export const AppSchema = displayTextCodecs.AppSchema;

type TextFields<Text> = { readonly label: Text; readonly hint?: Text };

const mapTextFields = <From, To>(
	label: From,
	hint: From | undefined,
	map: (text: From) => To,
): TextFields<To> =>
	hint === undefined ? { label: map(label) } : { hint: map(hint), label: map(label) };

const mapChoicesText = <From, To>(
	choices: AppChoices<From>,
	map: (text: From) => To,
): AppChoices<To> =>
	choices.kind === "dynamic"
		? choices
		: {
				kind: "static",
				values: choices.values.map(({ label, ...choice }) =>
					label === undefined ? choice : { ...choice, label: map(label) },
				),
			};

const mapPropertyText = <From, To>(
	property: AppPropertyDefinition<From>,
	map: (text: From) => To,
): AppPropertyDefinition<To> => {
	if (property.type === "enum") {
		const { hint, label, choices, ...rest } = property;
		return { ...rest, ...mapTextFields(label, hint, map), choices: mapChoicesText(choices, map) };
	}
	if (property.type === "enum-array") {
		const { hint, label, choices, ...rest } = property;
		return { ...rest, ...mapTextFields(label, hint, map), choices: mapChoicesText(choices, map) };
	}
	if (property.type === "array") {
		const { hint, label, items, ...rest } = property;
		return { ...rest, ...mapTextFields(label, hint, map), items: mapPropertyText(items, map) };
	}
	if (property.type === "object") {
		const { hint, label, properties, ...rest } = property;
		return {
			...rest,
			...mapTextFields(label, hint, map),
			properties: mapFieldsText(properties, map),
		};
	}
	const { hint, label, ...rest } = property;
	return { ...rest, ...mapTextFields(label, hint, map) };
};

const mapFieldsText = <From, To>(
	fields: AppSchemaFields<From>,
	map: (text: From) => To,
): AppSchemaFields<To> =>
	Object.fromEntries(
		Object.entries(fields).map(([key, property]) => [key, mapPropertyText(property, map)]),
	);

/** Replaces every display text in a schema: property labels, hints, and static choice labels. */
export const mapAppSchemaText = <From, To>(
	schema: AppSchema<From>,
	map: (text: From) => To,
): AppSchema<To> => ({ ...schema, fields: mapFieldsText(schema.fields, map) });

export type AppSchemaTextUse<Text> = { readonly text: Text; readonly path: string };

const propertyTexts = <Text>(
	property: AppPropertyDefinition<Text>,
	path: string,
): ReadonlyArray<AppSchemaTextUse<Text>> => [
	{ text: property.label, path: `${path}.label` },
	...(property.hint === undefined ? [] : [{ text: property.hint, path: `${path}.hint` }]),
	...((property.type === "enum" || property.type === "enum-array") &&
	property.choices.kind === "static"
		? property.choices.values.flatMap((choice) =>
				choice.label === undefined
					? []
					: [{ text: choice.label, path: `${path}.choices.${choice.value}.label` }],
			)
		: []),
	...(property.type === "array" ? propertyTexts(property.items, `${path}.items`) : []),
	...(property.type === "object"
		? Object.entries(property.properties).flatMap(([key, child]) =>
				propertyTexts(child, `${path}.properties.${key}`),
			)
		: []),
];

/** Lists every display text in a schema with its path below `fields`. */
export const appSchemaTexts = <Text>(schema: AppSchema<Text>) =>
	Object.entries(schema.fields).flatMap(([key, property]) =>
		propertyTexts(property, `fields.${key}`),
	);

export const getOrderedAppSchemaFieldEntries = <Text>(fields: AppSchemaFields<Text>) =>
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
export const isAppPropertyRequired = (property: AppPropertyDefinition<unknown>) =>
	property.validation?.required === true;

export const isEventReferenceProperty = <Text>(
	property: undefined | AppPropertyDefinition<Text>,
): property is AppStringProperty<Text> & {
	readonly reference: AppStringPropertyReference & { readonly kind: "event-id" };
} => property?.type === "string" && property.reference?.kind === "event-id";

export const getAppPropertyDefinitionAtPath = <Text>(
	fields: AppSchemaFields<Text>,
	path: AppSchemaRulePath,
) => {
	let property: undefined | AppPropertyDefinition<Text>;
	let currentFields = fields;
	for (const segment of path) {
		if (!Object.hasOwn(currentFields, segment)) {
			return undefined;
		}
		property = currentFields[segment];
		if (property === undefined) {
			return undefined;
		}
		currentFields = property.type === "object" ? property.properties : {};
	}
	return property;
};

export const getAppSchemaValueAtPath = (input: unknown, path: AppSchemaRulePath) => {
	let value = input;
	for (const segment of path) {
		if (
			typeof value !== "object" ||
			value === null ||
			Array.isArray(value) ||
			!Object.hasOwn(value, segment)
		) {
			return undefined;
		}
		value = Reflect.get(value, segment);
	}
	return value;
};

export const isMissingAppSchemaRequiredValue = (value: unknown) =>
	value === undefined || value === null;

export const evaluateAppSchemaRuleCondition = (
	condition: AppSchemaRuleCondition,
	input: unknown,
): boolean => {
	if (condition.operator === "all") {
		return condition.conditions.every((inner) => evaluateAppSchemaRuleCondition(inner, input));
	}
	if (condition.operator === "any") {
		return condition.conditions.some((inner) => evaluateAppSchemaRuleCondition(inner, input));
	}
	const value = getAppSchemaValueAtPath(input, condition.path);
	if (condition.operator === "exists") {
		return !isMissingAppSchemaRequiredValue(value);
	}
	if (condition.operator === "not_exists") {
		return isMissingAppSchemaRequiredValue(value);
	}
	if (condition.operator === "eq") {
		return Object.is(value, condition.value);
	}
	if (condition.operator === "neq") {
		return !Object.is(value, condition.value);
	}
	if (condition.operator === "in") {
		return condition.value.some((expected) => Object.is(value, expected));
	}
	return condition.value.every((expected) => !Object.is(value, expected));
};

export const areAppSchemaPathsEqual = (left: AppSchemaRulePath, right: AppSchemaRulePath) =>
	left.length === right.length && left.every((segment, index) => segment === right[index]);

export const isAppSchemaPathHidden = (
	schema: AppSchema<unknown>,
	path: AppSchemaRulePath,
	input: unknown,
) =>
	(schema.rules ?? []).some(
		(rule) =>
			rule.kind === "visibility" &&
			rule.path.length <= path.length &&
			rule.path.every((segment, index) => segment === path[index]) &&
			evaluateAppSchemaRuleCondition(rule.when, input),
	);

export const isAppSchemaPathEffectivelyRequired = (
	schema: AppSchema<unknown>,
	path: AppSchemaRulePath,
	input: unknown,
) => {
	const property = getAppPropertyDefinitionAtPath(schema.fields, path);
	if (property === undefined || isAppSchemaPathHidden(schema, path, input)) {
		return false;
	}
	return (
		isAppPropertyRequired(property) ||
		(schema.rules ?? []).some(
			(rule) =>
				rule.kind === "validation" &&
				areAppSchemaPathsEqual(rule.path, path) &&
				evaluateAppSchemaRuleCondition(rule.when, input),
		)
	);
};

/**
 * Returns the top-level property keys a schema declares as translatable. These are
 * the only properties a translation overlay is allowed to localize; everything else
 * (genres, runtimes, dates, ...) always renders in the canonical language.
 */
export const collectTranslatableProperties = (schema: AppSchema<unknown>): ReadonlyArray<string> =>
	Object.entries(schema.fields).flatMap(([key, definition]) =>
		definition.translatable === true ? [key] : [],
	);

/**
 * Returns the top-level property keys a schema declares as secret. These carry
 * credentials, so the client renders them as password inputs and the kernel redacts
 * them when handing a stored value back.
 */
export const collectSecretProperties = (schema: AppSchema<unknown>): ReadonlyArray<string> =>
	Object.entries(schema.fields).flatMap(([key, definition]) =>
		definition.secret === true ? [key] : [],
	);

/**
 * Returns the top-level property keys a schema declares as immutable. A user update
 * cannot change or remove a stored value for these.
 */
export const collectImmutableProperties = (schema: AppSchema<unknown>): ReadonlyArray<string> =>
	Object.entries(schema.fields).flatMap(([key, definition]) =>
		definition.immutable === true ? [key] : [],
	);
