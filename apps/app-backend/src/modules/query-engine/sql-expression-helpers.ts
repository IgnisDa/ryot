import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
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

export const getEventJoinColumnName = (joinKey: string) =>
	`event_join_${joinKey}`;

export const buildPropertyPathExpression = (
	base: SqlExpression,
	propertyPath: string[],
	mode: "json" | "text",
): SqlExpression => {
	const last = propertyPath.at(-1);
	if (!last) {
		throw new QueryEngineValidationError(
			"Property path must have at least one segment",
		);
	}

	const intermediate = propertyPath.slice(0, -1);
	let current = base;
	for (const segment of intermediate) {
		current = sql`${current} -> ${segment}`;
	}

	return mode === "text"
		? sql`${current} ->> ${last}`
		: sql`${current} -> ${last}`;
};

export const buildLiteralExpression = (
	value: unknown | null,
	targetType?: PropertyType,
) => {
	if (value === null) {
		return sql`null`;
	}

	const inferredLiteralType = (() => {
		if (typeof value === "string") {
			return "string" satisfies PropertyType;
		}

		if (typeof value === "boolean") {
			return "boolean" satisfies PropertyType;
		}

		if (typeof value === "number") {
			return Number.isInteger(value)
				? ("integer" satisfies PropertyType)
				: ("number" satisfies PropertyType);
		}

		if (Array.isArray(value)) {
			return "array" satisfies PropertyType;
		}

		return "object" satisfies PropertyType;
	})();
	const propertyType = targetType ?? inferredLiteralType;

	return match(propertyType)
		.with("integer", () => sql`cast(${value} as integer)`)
		.with("number", () => sql`cast(${value} as numeric)`)
		.with("boolean", () => sql`cast(${value} as boolean)`)
		.with("date", () => sql`cast(${value} as timestamptz)`)
		.with("array", "object", () => sql`${JSON.stringify(value)}::jsonb`)
		.otherwise(() => {
			if (typeof value === "object") {
				return sql`${JSON.stringify(value)}::jsonb`;
			}

			if (typeof value === "string") {
				return sql`cast(${value} as text)`;
			}

			return sql`${value}`;
		});
};

export const castExpressionToType = (
	expression: SqlExpression,
	targetType: PropertyType,
) => {
	return match(targetType)
		.with("number", () => sql`(${expression})::numeric`)
		.with("boolean", () => sql`(${expression})::boolean`)
		.with("date", () => sql`(${expression})::timestamptz`)
		.with("array", "object", () => sql`to_jsonb(${expression})`)
		.with("integer", () => sql`trunc((${expression})::numeric)::integer`)
		.otherwise(() => sql`(${expression})::text`);
};

export const buildTextValueExpression = (expression: SqlExpression) => {
	return sql`coalesce((${expression})::text, '')`;
};

export const buildIntegerNormalizationExpression = (
	expression: SqlExpression,
) => {
	return sql`trunc((${expression})::numeric)::integer`;
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
			["array", "object"].includes(
				normalizeExpressionPropertyType(input.typeInfo.propertyType),
			))
	) {
		return sql`nullif(${input.expression}, 'null'::jsonb)`;
	}

	return input.expression;
};

export const buildCastedValueExpression = (
	propertyType: PropertyType,
	input: { propertyText: SqlExpression; propertyJson: SqlExpression },
) =>
	match(propertyType)
		.with("number", () => sql`(${input.propertyText})::numeric`)
		.with("integer", () => sql`(${input.propertyText})::integer`)
		.with("boolean", () => sql`(${input.propertyText})::boolean`)
		.with("date", "datetime", () => sql`(${input.propertyText})::timestamptz`)
		.with("array", "object", () => input.propertyJson)
		.otherwise(() => input.propertyText);

export const buildCoalescedExpression = (expressions: SqlExpression[]) => {
	if (expressions.length === 1) {
		return expressions[0] ?? sql`null`;
	}

	return sql`coalesce(${sql.join(expressions, sql`, `)})`;
};
