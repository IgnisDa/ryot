import { sql } from "drizzle-orm";
import { Match } from "effect";

import { QueryEngineValidationError } from "~/lib/views/errors";
import {
	normalizeExpressionPropertyType,
	type ViewExpressionTypeInfo,
} from "~/lib/views/expression-analysis";
import type { PropertyType } from "~/lib/views/reference";

export type SqlExpression = ReturnType<typeof sql>;

const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const sanitizeIdentifier = (name: string, label: string) => {
	if (!VALID_IDENTIFIER.test(name)) {
		throw new QueryEngineValidationError(
			`Invalid SQL ${label}: '${name}' must be alphanumeric with underscores`,
		);
	}
	return name;
};

export const getEventJoinColumnName = (joinKey: string) => `event_join_${joinKey}`;

export const getRelationshipJoinCteName = (joinKey: string) =>
	`latest_relationship_join_${joinKey}`;

export const getRelationshipJoinColumnName = (joinKey: string) => `relationship_join_${joinKey}`;

export const buildPropertyPathExpression = (
	base: SqlExpression,
	propertyPath: string[],
	mode: "json" | "text",
): SqlExpression => {
	const last = propertyPath.at(-1);
	if (!last) {
		throw new QueryEngineValidationError("Property path must have at least one segment");
	}

	const intermediate = propertyPath.slice(0, -1);
	let current = base;
	for (const segment of intermediate) {
		current = sql`${current} -> ${segment}`;
	}

	return mode === "text" ? sql`${current} ->> ${last}` : sql`${current} -> ${last}`;
};

const resolveLiteralInput = (input: unknown, literalType: string | undefined) => {
	if (typeof input !== "object" || input === null) {
		return { value: input };
	}
	if ("value" in input && ("literalType" in input || "kind" in input || "type" in input)) {
		return { literalType, value: (input as Record<string, unknown>).value };
	}
	return { value: input };
};

const inferLiteralType = (value: unknown): PropertyType => {
	if (typeof value === "string") {
		return "string";
	}
	if (typeof value === "boolean") {
		return "boolean";
	}
	if (typeof value === "number") {
		return Number.isInteger(value) ? "integer" : "number";
	}
	if (Array.isArray(value)) {
		return "array";
	}
	return "object";
};

const getStringObjectProperty = (value: object, key: string) => {
	const property = Reflect.get(value, key);
	return typeof property === "string" ? property : undefined;
};

export const buildLiteralExpression = (input: unknown, targetType?: PropertyType) => {
	const literalType =
		typeof input === "object" && input !== null
			? (getStringObjectProperty(input, "literalType") ?? getStringObjectProperty(input, "kind"))
			: undefined;
	const literalInput = resolveLiteralInput(input, literalType);
	const { value } = literalInput;
	if (value === null) {
		return sql`null`;
	}

	if (literalInput.literalType === "date") {
		return sql`cast(${value} as timestamptz)`;
	}

	const inferredLiteralType = inferLiteralType(value);
	const propertyType = targetType ?? inferredLiteralType;

	return Match.value(propertyType).pipe(
		Match.when("integer", () => sql`cast(${value} as integer)`),
		Match.when("number", () => sql`cast(${value} as numeric)`),
		Match.when("boolean", () => sql`cast(${value} as boolean)`),
		Match.when("date", () => sql`cast(${value} as timestamptz)`),
		Match.whenOr("array", "object", () => sql`${JSON.stringify(value)}::jsonb`),
		Match.orElse(() => {
			if (typeof value === "object") {
				return sql`${JSON.stringify(value)}::jsonb`;
			}

			if (typeof value === "string") {
				return sql`cast(${value} as text)`;
			}

			return sql`${value}`;
		}),
	);
};

export const buildIntegerNormalizationExpression = (expression: SqlExpression) => {
	return sql`trunc((${expression})::numeric)::integer`;
};

export const castExpressionToType = (expression: SqlExpression, targetType: PropertyType) => {
	return Match.value(targetType).pipe(
		Match.when("number", () => sql`(${expression})::numeric`),
		Match.when("boolean", () => sql`(${expression})::boolean`),
		Match.when("date", () => sql`(${expression})::timestamptz`),
		Match.whenOr("array", "object", () => sql`to_jsonb(${expression})`),
		Match.when("integer", () => buildIntegerNormalizationExpression(expression)),
		Match.orElse(() => sql`(${expression})::text`),
	);
};

export const buildTextValueExpression = (expression: SqlExpression) => {
	return sql`coalesce((${expression})::text, '')`;
};

export const buildJsonNullNormalizedExpression = (input: {
	expression: SqlExpression;
	targetType?: PropertyType;
	typeInfo: ViewExpressionTypeInfo;
}) => {
	if (
		input.targetType === "array" ||
		input.targetType === "object" ||
		(input.typeInfo.kind === "property" &&
			["array", "object"].includes(normalizeExpressionPropertyType(input.typeInfo.propertyType)))
	) {
		return sql`nullif(${input.expression}, 'null'::jsonb)`;
	}

	return input.expression;
};

export const buildCastedValueExpression = (
	propertyType: PropertyType,
	input: { propertyText: SqlExpression; propertyJson: SqlExpression },
) =>
	Match.value(propertyType).pipe(
		Match.when("number", () => sql`(${input.propertyText})::numeric`),
		Match.when("integer", () => sql`(${input.propertyText})::integer`),
		Match.when("boolean", () => sql`(${input.propertyText})::boolean`),
		Match.whenOr("date", "datetime", () => sql`(${input.propertyText})::timestamptz`),
		Match.whenOr("array", "object", () => input.propertyJson),
		Match.orElse(() => input.propertyText),
	);

export const buildJsonColumnPropertyExpression = (input: {
	propertyPath: string[];
	propertyType: PropertyType;
	base: SqlExpression;
	targetType?: PropertyType;
}) => {
	return buildCastedValueExpression(
		input.targetType ?? normalizeExpressionPropertyType(input.propertyType),
		{
			propertyJson: buildPropertyPathExpression(input.base, input.propertyPath, "json"),
			propertyText: buildPropertyPathExpression(input.base, input.propertyPath, "text"),
		},
	);
};

export const buildCoalescedExpression = (expressions: SqlExpression[]) => {
	if (expressions.length === 1) {
		return expressions[0] ?? sql`null`;
	}

	return sql`coalesce(${sql.join(expressions, sql`, `)})`;
};
