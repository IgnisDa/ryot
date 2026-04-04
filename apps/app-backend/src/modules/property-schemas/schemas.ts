import { z } from "@hono/zod-openapi";
import type {
	AppPropertyDefinition,
	AppPropertyPrimitiveType,
	AppSchema,
	AppSchemaFields,
	AppSchemaRuleCondition,
	AppSchemaRuleValue,
	AppSchemaUnknownKeysPolicy,
} from "@ryot/ts-utils";
import {
	appPropertyPrimitiveTypes,
	getAppPropertyDefinitionAtPath,
} from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { getComparablePropertyType } from "~/lib/views/policy";

const propertySchemaMessage = "Properties must contain at least one property";

const createPropertySchemaMessage = (label: string) =>
	`${label} must contain at least one property`;

const validRegexSchema = z.string().refine(
	(value) => {
		try {
			new RegExp(value);
			return true;
		} catch {
			return false;
		}
	},
	{ message: "Pattern must be a valid regular expression" },
);

const withValidationRange = <TSchema extends z.ZodTypeAny>(
	schema: TSchema,
	minKey: string,
	maxKey: string,
) =>
	schema.refine(
		(value) => {
			const min = value[minKey as keyof typeof value];
			const max = value[maxKey as keyof typeof value];
			if (typeof min !== "number" || typeof max !== "number") {
				return true;
			}

			return min <= max;
		},
		{ message: `${minKey} must be less than or equal to ${maxKey}` },
	);

const requiredValidationSchema = z.strictObject({
	required: z.literal(true).optional(),
});

const unknownKeysPolicySchema: z.ZodType<AppSchemaUnknownKeysPolicy> = z.enum([
	"strip",
	"strict",
	"passthrough",
]);

const hasValidNumericBounds = (value: {
	maximum?: number;
	minimum?: number;
	exclusiveMaximum?: number;
	exclusiveMinimum?: number;
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

const numberValidationSchema = withValidationRange(
	z
		.strictObject({
			maximum: z.number().finite().optional(),
			minimum: z.number().finite().optional(),
			required: z.literal(true).optional(),
			multipleOf: z.number().positive().optional(),
			exclusiveMaximum: z.number().finite().optional(),
			exclusiveMinimum: z.number().finite().optional(),
		})
		.refine(
			(value) => {
				if (
					value.minimum !== undefined &&
					value.exclusiveMinimum !== undefined
				) {
					return false;
				}

				if (
					value.maximum !== undefined &&
					value.exclusiveMaximum !== undefined
				) {
					return false;
				}

				return true;
			},
			{
				message:
					"Use either minimum or exclusiveMinimum, and either maximum or exclusiveMaximum",
			},
		)
		.refine(hasValidNumericBounds, {
			message: "Lower bounds must be less than upper bounds",
		}),
	"minimum",
	"maximum",
).openapi("AppNumberPropertyValidation");

const stringValidationSchema = withValidationRange(
	z.strictObject({
		pattern: validRegexSchema.optional(),
		required: z.literal(true).optional(),
		maxLength: z.number().int().min(0).optional(),
		minLength: z.number().int().min(0).optional(),
	}),
	"minLength",
	"maxLength",
).openapi("AppStringPropertyValidation");

const arrayValidationSchema = withValidationRange(
	z.strictObject({
		required: z.literal(true).optional(),
		maxItems: z.number().int().min(0).optional(),
		minItems: z.number().int().min(0).optional(),
	}),
	"minItems",
	"maxItems",
).openapi("AppArrayPropertyValidation");

const requiredOnlyValidationSchema = requiredValidationSchema.openapi(
	"AppRequiredPropertyValidation",
);

const roundTransformSchema = z
	.strictObject({
		mode: z.literal("half_up"),
		scale: z.number().int().min(0),
	})
	.openapi("AppRoundTransform");

const numberTransformSchema = z
	.strictObject({ round: roundTransformSchema.optional() })
	.openapi("AppNumberPropertyTransform");

const rulePathSchema = z
	.array(z.string().trim().min(1))
	.min(1)
	.openapi("AppSchemaRulePath");

const ruleValueSchema: z.ZodType<AppSchemaRuleValue> = z
	.union([z.boolean(), z.null(), z.number().finite(), z.string()])
	.openapi("AppSchemaRuleValue");

export let propertyDefinitionSchema: z.ZodType<AppPropertyDefinition>;
export let appSchemaRuleConditionSchema: z.ZodType<AppSchemaRuleCondition>;

const stringPropertySchema = z
	.strictObject({
		type: z.literal("string"),
		validation: stringValidationSchema.optional(),
	})
	.openapi("AppStringProperty");

const numberPropertySchema = z
	.strictObject({
		type: z.literal("number"),
		transform: numberTransformSchema.optional(),
		validation: numberValidationSchema.optional(),
	})
	.openapi("AppNumberProperty");

const integerPropertySchema = z
	.strictObject({
		type: z.literal("integer"),
		transform: numberTransformSchema.optional(),
		validation: numberValidationSchema.optional(),
	})
	.openapi("AppIntegerProperty");

const booleanPropertySchema = z
	.strictObject({
		type: z.literal("boolean"),
		validation: requiredOnlyValidationSchema.optional(),
	})
	.openapi("AppBooleanProperty");

const datePropertySchema = z
	.strictObject({
		type: z.literal("date"),
		validation: requiredOnlyValidationSchema.optional(),
	})
	.openapi("AppDateProperty");

const datetimePropertySchema = z
	.strictObject({
		type: z.literal("datetime"),
		validation: requiredOnlyValidationSchema.optional(),
	})
	.openapi("AppDateTimeProperty");

const arrayPropertySchema = z
	.strictObject({
		type: z.literal("array"),
		validation: arrayValidationSchema.optional(),
		items: z.lazy(() => propertyDefinitionSchema),
	})
	.openapi("AppArrayProperty");

const objectPropertySchema = z
	.strictObject({
		type: z.literal("object"),
		unknownKeys: unknownKeysPolicySchema.optional(),
		validation: requiredOnlyValidationSchema.optional(),
		properties: z.record(
			z.string(),
			z.lazy(() => propertyDefinitionSchema),
		),
	})
	.openapi("AppObjectProperty");

propertyDefinitionSchema = z
	.lazy(() =>
		z.discriminatedUnion("type", [
			datePropertySchema,
			datetimePropertySchema,
			arrayPropertySchema,
			objectPropertySchema,
			stringPropertySchema,
			numberPropertySchema,
			integerPropertySchema,
			booleanPropertySchema,
		]),
	)
	.openapi(
		"AppPropertyDefinition",
	) as unknown as z.ZodType<AppPropertyDefinition>;

const ruleConditionPropertySchema = z
	.strictObject({
		path: rulePathSchema,
		value: ruleValueSchema,
		operator: z.literal("eq"),
	})
	.openapi("AppSchemaEqRuleCondition");

const ruleConditionNotEqualsSchema = z
	.strictObject({
		path: rulePathSchema,
		value: ruleValueSchema,
		operator: z.literal("neq"),
	})
	.openapi("AppSchemaNeqRuleCondition");

const ruleConditionExistsSchema = z
	.strictObject({
		path: rulePathSchema,
		operator: z.literal("exists"),
	})
	.openapi("AppSchemaExistsRuleCondition");

const ruleConditionNotExistsSchema = z
	.strictObject({
		path: rulePathSchema,
		operator: z.literal("not_exists"),
	})
	.openapi("AppSchemaNotExistsRuleCondition");

const ruleConditionInSchema = z
	.strictObject({
		path: rulePathSchema,
		value: z.array(ruleValueSchema).min(1),
		operator: z.literal("in"),
	})
	.openapi("AppSchemaInRuleCondition");

const ruleConditionNotInSchema = z
	.strictObject({
		path: rulePathSchema,
		value: z.array(ruleValueSchema).min(1),
		operator: z.literal("not_in"),
	})
	.openapi("AppSchemaNotInRuleCondition");

appSchemaRuleConditionSchema = z
	.lazy(() =>
		z.discriminatedUnion("operator", [
			ruleConditionPropertySchema,
			ruleConditionNotEqualsSchema,
			ruleConditionExistsSchema,
			ruleConditionNotExistsSchema,
			ruleConditionInSchema,
			ruleConditionNotInSchema,
			z.strictObject({
				operator: z.literal("all"),
				conditions: z.array(appSchemaRuleConditionSchema).min(1),
			}),
			z.strictObject({
				operator: z.literal("any"),
				conditions: z.array(appSchemaRuleConditionSchema).min(1),
			}),
		]),
	)
	.openapi(
		"AppSchemaRuleCondition",
	) as unknown as z.ZodType<AppSchemaRuleCondition>;

const appSchemaRuleSchema = z
	.strictObject({
		path: rulePathSchema,
		when: appSchemaRuleConditionSchema,
		kind: z.literal("validation"),
		message: z.string().trim().min(1).optional(),
		validation: z.strictObject({ required: z.literal(true) }),
	})
	.openapi("AppSchemaRule");

const fieldsSchema = z.record(z.string(), propertyDefinitionSchema);

const createNonEmptyFieldsSchema = (message: string) =>
	fieldsSchema.refine((value) => Object.keys(value).length > 0, { message });

const isCompatibleRuleValue = (
	type: AppPropertyPrimitiveType,
	value: AppSchemaRuleValue,
) => {
	return match(type)
		.with("boolean", () => typeof value === "boolean")
		.with("date", "datetime", "string", () => typeof value === "string")
		.with("integer", () => typeof value === "number" && Number.isInteger(value))
		.with("number", () => typeof value === "number" && Number.isFinite(value))
		.exhaustive();
};

const validateRuleCondition = (
	fields: AppSchemaFields,
	condition: AppSchemaRuleCondition,
	ctx: z.RefinementCtx,
	path: (string | number)[],
) => {
	match(condition)
		.with({ operator: "all" }, { operator: "any" }, (cond) => {
			for (const [index, value] of cond.conditions.entries()) {
				validateRuleCondition(fields, value, ctx, [
					...path,
					"conditions",
					index,
				]);
			}
		})
		.otherwise((cond) => {
			const property = getAppPropertyDefinitionAtPath(fields, cond.path);
			if (!property) {
				ctx.addIssue({
					code: "custom",
					path: [...path, "path"],
					message: `Rule condition path '${cond.path.join(".")}' does not exist`,
				});
				return;
			}

			if (cond.operator === "exists" || cond.operator === "not_exists") {
				return;
			}

			const propertyType = getComparablePropertyType(property);
			if (!propertyType) {
				ctx.addIssue({
					code: "custom",
					path: [...path, "path"],
					message:
						"Rule conditions can only compare primitive string, number, integer, boolean, date, or datetime properties",
				});
				return;
			}

			const values = Array.isArray(cond.value) ? cond.value : [cond.value];
			if (values.every((value) => isCompatibleRuleValue(propertyType, value))) {
				return;
			}

			ctx.addIssue({
				code: "custom",
				path: [...path, "value"],
				message: `Rule condition values must match the '${propertyType}' property type`,
			});
		});
};

const validateRulePaths = (schema: AppSchema, ctx: z.RefinementCtx) => {
	for (const [index, rule] of (schema.rules ?? []).entries()) {
		const property = getAppPropertyDefinitionAtPath(schema.fields, rule.path);
		if (!property) {
			ctx.addIssue({
				code: "custom",
				path: ["rules", index, "path"],
				message: `Rule path '${rule.path.join(".")}' does not exist`,
			});
			continue;
		}

		validateRuleCondition(schema.fields, rule.when, ctx, [
			"rules",
			index,
			"when",
		]);
	}
};

export const createPropertySchemaObjectSchema = (message?: string) =>
	z
		.strictObject({
			rules: z.array(appSchemaRuleSchema).optional(),
			fields: message ? createNonEmptyFieldsSchema(message) : fieldsSchema,
		})
		.superRefine(validateRulePaths);

export const createPropertySchemaInputSchema = (message: string) =>
	createPropertySchemaObjectSchema(message);

export const createLabeledPropertySchemas = (label: string) => {
	const schema = createPropertySchemaObjectSchema();
	const message = createPropertySchemaMessage(label);
	const inputSchema = createPropertySchemaInputSchema(message);

	return { inputSchema, schema };
};

export const propertySchemaObjectSchema: z.ZodType<AppSchema> =
	createPropertySchemaObjectSchema().openapi("AppSchema");

export const propertySchemaInputSchema = createPropertySchemaInputSchema(
	propertySchemaMessage,
);

export const propertySchemaTypes = appPropertyPrimitiveTypes;
