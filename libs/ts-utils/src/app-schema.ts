import { match } from "ts-pattern";
import { z } from "zod";

export const appPropertyPrimitiveTypes = [
	"string",
	"number",
	"integer",
	"boolean",
	"date",
	"datetime",
] as const;

export type AppPropertyPrimitiveType = (typeof appPropertyPrimitiveTypes)[number];

export type AppSchemaRulePath = string[];

export type AppSchemaRuleValue = unknown;

type AppPropertyValidationBase = {
	required?: true;
};

export type AppPropertyRoundTransform = {
	mode: "half_up";
	scale: number;
};

export type AppPropertyTransform = {
	round?: AppPropertyRoundTransform;
};

export type AppSchemaUnknownKeysPolicy = "strip" | "strict" | "passthrough";

export type AppArrayPropertyValidation = AppPropertyValidationBase & {
	maxItems?: number;
	minItems?: number;
};

export type AppNumberPropertyValidation = AppPropertyValidationBase & {
	maximum?: number;
	minimum?: number;
	multipleOf?: number;
	exclusiveMaximum?: number;
	exclusiveMinimum?: number;
};

export type AppObjectPropertyValidation = AppPropertyValidationBase;

export type AppStringPropertyValidation = AppPropertyValidationBase & {
	pattern?: string;
	maxLength?: number;
	minLength?: number;
};

type AppPropertyBase<TValidation> = {
	label: string;
	description: string;
	validation?: TValidation;
	transform?: AppPropertyTransform;
};

export type AppStringProperty = AppPropertyBase<AppStringPropertyValidation> & {
	type: "string";
};

export type AppNumberProperty = AppPropertyBase<AppNumberPropertyValidation> & {
	type: "number";
};

export type AppIntegerProperty = AppPropertyBase<AppNumberPropertyValidation> & {
	type: "integer";
};

export type AppBooleanProperty = AppPropertyBase<AppPropertyValidationBase> & {
	type: "boolean";
};

export type AppDateProperty = AppPropertyBase<AppPropertyValidationBase> & {
	type: "date";
};

export type AppDateTimeProperty = AppPropertyBase<AppPropertyValidationBase> & {
	type: "datetime";
};

export type AppPrimitiveProperty =
	| AppDateProperty
	| AppStringProperty
	| AppNumberProperty
	| AppIntegerProperty
	| AppBooleanProperty
	| AppDateTimeProperty;

export type AppArrayProperty = AppPropertyBase<AppArrayPropertyValidation> & {
	type: "array";
	items: AppPropertyDefinition;
};

export type AppObjectProperty = AppPropertyBase<AppObjectPropertyValidation> & {
	type: "object";
	unknownKeys?: AppSchemaUnknownKeysPolicy;
	properties: Record<string, AppPropertyDefinition>;
};

export type AppEnumProperty = AppPropertyBase<AppPropertyValidationBase> & {
	type: "enum";
	options: [string, ...string[]];
};

export type AppEnumArrayProperty = AppPropertyBase<AppArrayPropertyValidation> & {
	type: "enum-array";
	options: [string, ...string[]];
};

export type AppPropertyDefinition =
	| AppArrayProperty
	| AppEnumProperty
	| AppObjectProperty
	| AppPrimitiveProperty
	| AppEnumArrayProperty;

export type AppSchemaFields = Record<string, AppPropertyDefinition>;

type AppSchemaLeafRuleCondition<T extends string, TValue = never> = {
	operator: T;
	path: AppSchemaRulePath;
} & ([TValue] extends [never] ? object : { value: TValue });

export type AppSchemaRuleCondition =
	| AppSchemaLeafRuleCondition<"eq", AppSchemaRuleValue>
	| AppSchemaLeafRuleCondition<"neq", AppSchemaRuleValue>
	| AppSchemaLeafRuleCondition<"exists">
	| AppSchemaLeafRuleCondition<"not_exists">
	| AppSchemaLeafRuleCondition<"in", AppSchemaRuleValue[]>
	| AppSchemaLeafRuleCondition<"not_in", AppSchemaRuleValue[]>
	| {
			operator: "all";
			conditions: AppSchemaRuleCondition[];
	  }
	| {
			operator: "any";
			conditions: AppSchemaRuleCondition[];
	  };

export type AppSchemaValidationRule = {
	message?: string;
	kind: "validation";
	path: AppSchemaRulePath;
	when: AppSchemaRuleCondition;
	validation: { required: true };
};

export type AppSchemaRule = AppSchemaValidationRule;

export type AppSchema = {
	fields: AppSchemaFields;
	rules?: AppSchemaRule[];
};

type AppSchemaObjectOptions = {
	unknownKeys?: AppSchemaUnknownKeysPolicy;
};

const withUnknownKeysPolicy = (
	shape: Record<string, z.ZodType>,
	unknownKeys?: AppSchemaUnknownKeysPolicy,
) => {
	if (unknownKeys === "passthrough") {
		return z.object(shape).passthrough();
	}

	if (unknownKeys === "strip") {
		return z.object(shape);
	}

	return z.object(shape).strict();
};

const getUnknownKeysPolicy = (schema: z.ZodObject<z.ZodRawShape>): AppSchemaUnknownKeysPolicy => {
	const definition = schema._def as {
		catchall?: { _def?: { type?: string } };
	};
	const catchallType = definition.catchall?._def?.type;
	if (catchallType === "unknown") {
		return "passthrough";
	}

	if (catchallType === "never") {
		return "strict";
	}

	return "strip";
};

const roundHalfUp = (value: number, scale: number) => {
	const factor = 10 ** scale;
	return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const getDefaultPropertyLabel = (key: string) =>
	key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim()
		.replace(/\s+/g, " ")
		.replace(/\b\w/g, (value) => value.toUpperCase());

const getValueAtPath = (input: unknown, path: AppSchemaRulePath) => {
	let value = input;

	for (const segment of path) {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return undefined;
		}

		value = (value as Record<string, unknown>)[segment];
	}

	return value;
};

const isRuleConditionMet = (
	condition: AppSchemaRuleCondition,
	input: Record<string, unknown>,
): boolean => {
	return match(condition)
		.with({ operator: "all" }, (cond) =>
			cond.conditions.every((value) => isRuleConditionMet(value, input)),
		)
		.with({ operator: "any" }, (cond) =>
			cond.conditions.some((value) => isRuleConditionMet(value, input)),
		)
		.with({ operator: "exists" }, (cond) => getValueAtPath(input, cond.path) !== undefined)
		.with({ operator: "not_exists" }, (cond) => getValueAtPath(input, cond.path) === undefined)
		.with({ operator: "eq" }, (cond) => Object.is(getValueAtPath(input, cond.path), cond.value))
		.with({ operator: "neq" }, (cond) => !Object.is(getValueAtPath(input, cond.path), cond.value))
		.with({ operator: "in" }, (cond) =>
			cond.value.some((value) => Object.is(getValueAtPath(input, cond.path), value)),
		)
		.with({ operator: "not_in" }, (cond) =>
			cond.value.every((value) => !Object.is(getValueAtPath(input, cond.path), value)),
		)
		.exhaustive();
};

const withAppSchemaRules = (
	schema: z.ZodObject<Record<string, z.ZodType>>,
	appSchema: AppSchema,
): z.ZodType<Record<string, unknown>> => {
	if (!appSchema.rules?.length) {
		return schema;
	}

	return schema.superRefine((input, ctx) => {
		for (const rule of appSchema.rules ?? []) {
			if (!isRuleConditionMet(rule.when, input)) {
				continue;
			}

			match(rule)
				.with({ kind: "validation" }, (r) => {
					if (r.validation.required && getValueAtPath(input, r.path) === undefined) {
						ctx.addIssue({
							path: r.path,
							code: "custom",
							message: r.message ?? `${r.path.join(".")} is required`,
						});
					}
				})
				.exhaustive();
		}
	});
};

const isRequiredSchema = (schema: z.ZodType) => {
	let value = schema;
	let isRequired = true;

	while (true) {
		if (value instanceof z.ZodOptional || value instanceof z.ZodNullable) {
			isRequired = false;
			value = value.unwrap() as z.ZodType;
			continue;
		}

		return { isRequired, value };
	}
};

const withRequiredValidation = <T extends AppPropertyDefinition>(
	property: T,
	isRequired: boolean,
) => {
	if (!isRequired) {
		return property;
	}

	return {
		...property,
		validation: { ...property.validation, required: true },
	};
};

const withoutRequiredValidation = <T extends AppPropertyDefinition>(property: T) => {
	if (!property.validation?.required) {
		return property;
	}

	const validation = { ...property.validation };
	delete validation.required;

	if (Object.keys(validation).length === 0) {
		const { validation: _validation, ...value } = property;
		return value as T;
	}

	return { ...property, validation };
};

const applyStringValidation = (
	schema: z.ZodString,
	validation: AppStringPropertyValidation | undefined,
) => {
	let value = schema;

	if (validation?.minLength !== undefined) {
		value = value.min(validation.minLength);
	}

	if (validation?.maxLength !== undefined) {
		value = value.max(validation.maxLength);
	}

	if (validation?.pattern) {
		value = value.regex(new RegExp(validation.pattern));
	}

	return value;
};

const applyNumberValidation = (
	schema: z.ZodNumber,
	validation: AppNumberPropertyValidation | undefined,
) => {
	let value = schema;

	if (validation?.minimum !== undefined) {
		value = value.gte(validation.minimum);
	}

	if (validation?.maximum !== undefined) {
		value = value.lte(validation.maximum);
	}

	if (validation?.exclusiveMinimum !== undefined) {
		value = value.gt(validation.exclusiveMinimum);
	}

	if (validation?.exclusiveMaximum !== undefined) {
		value = value.lt(validation.exclusiveMaximum);
	}

	if (validation?.multipleOf !== undefined) {
		const multipleOf = validation.multipleOf;
		value = value.refine(
			(input) => {
				const quotient = input / multipleOf;
				return Math.abs(quotient - Math.round(quotient)) < Number.EPSILON * 10;
			},
			{ message: `Number must be a multiple of ${multipleOf}` },
		);
	}

	return value;
};

const applyArrayValidation = (
	schema: z.ZodArray<z.ZodType>,
	validation: AppArrayPropertyValidation | undefined,
) => {
	let value = schema;

	if (validation?.minItems !== undefined) {
		value = value.min(validation.minItems);
	}

	if (validation?.maxItems !== undefined) {
		value = value.max(validation.maxItems);
	}

	return value;
};

const createEnumProperty = (input: {
	isRequired: boolean;
	label: string;
	description: string;
	options: string[];
}) => {
	if (input.options.length === 0) {
		throw new Error("Enum property must contain at least one option");
	}

	return withRequiredValidation(
		{
			label: input.label,
			description: input.description,
			type: "enum",
			options: input.options as [string, ...string[]],
		},
		input.isRequired,
	);
};

const toAppSchemaDiscriminatedUnion = (input: {
	label: string;
	description: string;
	isRequired: boolean;
	value: { options: readonly unknown[] };
}) => {
	const options = input.value.options.filter(
		(option): option is z.ZodObject<z.ZodRawShape> => option instanceof z.ZodObject,
	);
	const properties: Record<string, AppPropertyDefinition> = {};
	const keys = new Set<string>();
	const unknownKeys = options[0] ? getUnknownKeysPolicy(options[0]) : undefined;

	for (const option of options) {
		for (const key of Object.keys(option.shape)) {
			keys.add(key);
		}
	}

	for (const key of keys) {
		const childSchemas = options
			.map((option) => option.shape[key] as z.ZodType | undefined)
			.filter((value): value is z.ZodType => value !== undefined);
		if (childSchemas.length === 0) {
			continue;
		}

		const label = getDefaultPropertyLabel(key);
		const description = childSchemas[0]?.description ?? label;
		const isRequiredInAllOptions = options.every((option) => key in option.shape);
		const property = childSchemas.every((child) => child instanceof z.ZodLiteral)
			? createEnumProperty({
					label,
					description,
					isRequired: isRequiredInAllOptions,
					options: [...new Set(childSchemas.flatMap((child) => Array.from(child.values)))].filter(
						(value): value is string => typeof value === "string",
					),
				})
			: toAppSchemaInternal(
					childSchemas[0] as z.ZodType,
					isRequiredInAllOptions,
					label,
					description,
				);

		properties[key] = isRequiredInAllOptions ? property : withoutRequiredValidation(property);
	}

	return withRequiredValidation(
		{
			label: input.label,
			description: input.description,
			type: "object",
			properties,
			...(unknownKeys === "strip" || unknownKeys === "passthrough" ? { unknownKeys } : {}),
		},
		input.isRequired,
	);
};

const withNumberTransform = (schema: z.ZodNumber, transform: AppPropertyTransform | undefined) => {
	const round = transform?.round;
	if (!round) {
		return schema as z.ZodType;
	}

	return z.preprocess(
		(input) => (typeof input === "number" ? roundHalfUp(input, round.scale) : input),
		schema,
	);
};

export const isAppPropertyRequired = (property: AppPropertyDefinition) =>
	!!property.validation?.required;

export const getAppPropertyDefinitionAtPath = (
	fields: AppSchemaFields,
	path: AppSchemaRulePath,
): AppPropertyDefinition | undefined => {
	let currentFields = fields;
	let currentProperty: AppPropertyDefinition | undefined;

	for (const segment of path) {
		currentProperty = currentFields[segment];
		if (!currentProperty) {
			return;
		}

		if (currentProperty.type !== "object") {
			currentFields = {};
			continue;
		}

		currentFields = currentProperty.properties;
	}

	return currentProperty;
};

const toAppSchemaInternal = (
	schema: z.ZodType,
	includeRequiredValidation: boolean,
	label: string,
	description: string,
): AppPropertyDefinition => {
	const { isRequired, value } = isRequiredSchema(schema);
	const applyRequiredValidation = <T extends AppPropertyDefinition>(property: T) =>
		includeRequiredValidation ? withRequiredValidation(property, isRequired) : property;

	if (value instanceof z.ZodString) {
		return applyRequiredValidation(
			value.format === "date"
				? { label, description, type: "date" }
				: { label, description, type: "string" },
		);
	}

	if (value instanceof z.ZodNumber) {
		return applyRequiredValidation(
			value.format === "safeint"
				? { label, description, type: "integer" }
				: { label, description, type: "number" },
		);
	}

	if (value instanceof z.ZodBoolean) {
		return applyRequiredValidation({ label, description, type: "boolean" });
	}

	if (value instanceof z.ZodEnum) {
		return createEnumProperty({
			label,
			description,
			isRequired,
			options: value.options.filter((option): option is string => typeof option === "string"),
		});
	}

	if (value instanceof z.ZodLiteral) {
		return createEnumProperty({
			label,
			description,
			isRequired,
			options: Array.from(value.values).filter(
				(option): option is string => typeof option === "string",
			),
		});
	}

	if (value.constructor.name === "ZodISODateTime") {
		return applyRequiredValidation({ label, description, type: "datetime" });
	}

	if (value instanceof z.ZodArray) {
		return applyRequiredValidation({
			label,
			description,
			items: withoutRequiredValidation(
				toAppSchemaInternal(
					value.element as z.ZodType,
					false,
					"Item",
					(value.element as z.ZodType).description ?? "Item",
				),
			),
			type: "array",
		});
	}

	if (value instanceof z.ZodObject) {
		const properties: Record<string, AppPropertyDefinition> = {};
		for (const [key, child] of Object.entries(value.shape)) {
			const childLabel = getDefaultPropertyLabel(key);
			properties[key] = toAppSchemaInternal(
				child as z.ZodType,
				true,
				childLabel,
				(child as z.ZodType).description ?? childLabel,
			);
		}

		const unknownKeys = getUnknownKeysPolicy(value);
		return applyRequiredValidation({
			label,
			description,
			properties,
			type: "object",
			...(unknownKeys === "strip" || unknownKeys === "passthrough" ? { unknownKeys } : {}),
		});
	}

	if (value instanceof z.ZodDiscriminatedUnion) {
		return toAppSchemaDiscriminatedUnion({
			label,
			description,
			isRequired,
			value,
		});
	}

	throw new Error(`Unsupported Zod type: ${value.constructor.name}`);
};

export const toAppSchema = (schema: z.ZodType): AppPropertyDefinition =>
	toAppSchemaInternal(schema, true, "Value", schema.description ?? "Value");

export const toAppSchemaProperties = (schema: z.ZodObject<z.ZodRawShape>): AppSchema => {
	const fields: AppSchemaFields = {};

	for (const [key, value] of Object.entries(schema.shape)) {
		const label = getDefaultPropertyLabel(key);
		fields[key] = toAppSchemaInternal(
			value as z.ZodType,
			false,
			label,
			(value as z.ZodType).description ?? label,
		);
	}

	return { fields };
};

export const fromAppSchema = (property: AppPropertyDefinition): z.ZodType => {
	const isRequired = isAppPropertyRequired(property);
	return match(property)
		.with({ type: "string" }, (p) => {
			const schema = applyStringValidation(z.string(), p.validation);
			return isRequired ? schema : schema.nullish();
		})
		.with({ type: "date" }, () => (isRequired ? z.iso.date() : z.iso.date().nullish()))
		.with({ type: "datetime" }, () => (isRequired ? z.iso.datetime() : z.iso.datetime().nullish()))
		.with({ type: "boolean" }, () => (isRequired ? z.boolean() : z.boolean().nullish()))
		.with({ type: "number" }, (p) => {
			const schema = applyNumberValidation(z.number(), p.validation);
			const withTransform = withNumberTransform(schema, p.transform);
			return isRequired ? withTransform : withTransform.nullish();
		})
		.with({ type: "integer" }, (p) => {
			const schema = applyNumberValidation(z.number().int(), p.validation);
			const withTransform = withNumberTransform(schema, p.transform);
			return isRequired ? withTransform : withTransform.nullish();
		})
		.with({ type: "enum" }, (p) => {
			const schema = z.enum(p.options);
			return isRequired ? schema : schema.nullish();
		})
		.with({ type: "enum-array" }, (p) => {
			const schema = applyArrayValidation(z.array(z.enum(p.options)), p.validation);
			return isRequired ? schema : schema.nullish();
		})
		.with({ type: "array" }, (p) => {
			const schema = applyArrayValidation(z.array(fromAppSchema(p.items)), p.validation);
			return isRequired ? schema : schema.nullish();
		})
		.with({ type: "object" }, (p) => {
			const shape: Record<string, z.ZodType> = {};
			for (const [key, value] of Object.entries(p.properties)) {
				const schema = fromAppSchema(value);
				shape[key] = isAppPropertyRequired(value) ? schema : schema.optional();
			}
			const schema = withUnknownKeysPolicy(shape, p.unknownKeys);
			return isRequired ? schema : schema.nullish();
		})
		.exhaustive();
};

export const fromAppSchemaObject = (
	appSchema: AppSchema,
	options?: AppSchemaObjectOptions,
): z.ZodType<Record<string, unknown>> => {
	const shape: Record<string, z.ZodType> = {};

	for (const [key, value] of Object.entries(appSchema.fields)) {
		const schema = fromAppSchema(value);
		shape[key] = isAppPropertyRequired(value) ? schema : schema.optional();
	}

	const schema = withUnknownKeysPolicy(shape, options?.unknownKeys);

	return withAppSchemaRules(schema, appSchema);
};
