import { Effect, Match } from "effect";

import type { CurrentDb } from "#lib/db";
import { BadRequest, type DbError, type NotFound } from "#lib/errors";

import type {
	AggregateOutput,
	AggregationSpec,
	Expr,
	FieldDef,
	FieldValue,
	RowItem,
	RowValue,
	Source,
} from "../language";
import {
	evalEventFieldSelector,
	evalFieldSelector,
	evalRelationshipFieldSelector,
	fieldValueScalar,
	valueToFieldValue,
} from "./field-values";
import { executeSourceMatches } from "./source-matches";
import { MAX_AGGREGATE_EXPRESSION_SOURCE_ROWS, type RowContext, type SourceMatch } from "./types";

const evalRefInContext = (expr: Extract<Expr, { type: "ref" }>, context: RowContext) => {
	const eventRow = context.events.get(expr.sourceAlias);
	if (eventRow !== undefined) {
		return evalEventFieldSelector(expr.field, eventRow);
	}

	const relationshipRow = context.relationships.get(expr.sourceAlias);
	if (relationshipRow !== undefined) {
		return evalRelationshipFieldSelector(expr.field, relationshipRow);
	}

	const entityRow = context.entities.get(expr.sourceAlias);
	if (entityRow !== undefined) {
		return evalFieldSelector(expr.field, entityRow);
	}

	return { kind: "null" as const, value: null };
};

const compareValues = (
	left: unknown,
	right: unknown,
	operator: Extract<Expr, { type: "comparison" }>["operator"],
) => {
	if (left === null || left === undefined || right === null || right === undefined) {
		return false;
	}

	const normalizedLeft = left instanceof Date ? left.toISOString() : left;
	const normalizedRight = right instanceof Date ? right.toISOString() : right;
	const compareOrdered = (compare: (result: number) => boolean) => {
		if (typeof normalizedLeft === "number" && typeof normalizedRight === "number") {
			return compare(normalizedLeft - normalizedRight);
		}
		if (typeof normalizedLeft === "string" && typeof normalizedRight === "string") {
			return compare(normalizedLeft.localeCompare(normalizedRight));
		}
		return false;
	};

	return Match.value(operator).pipe(
		Match.when("eq", () => left === right),
		Match.when("neq", () => left !== right),
		Match.when("gt", () => compareOrdered((result) => result > 0)),
		Match.when("gte", () => compareOrdered((result) => result >= 0)),
		Match.when("lt", () => compareOrdered((result) => result < 0)),
		Match.when("lte", () => compareOrdered((result) => result <= 0)),
		Match.exhaustive,
	);
};

const containsValue = (left: unknown, right: unknown) => {
	if (typeof left === "string" && typeof right === "string") {
		return left.toLowerCase().includes(right.toLowerCase());
	}
	if (Array.isArray(left)) {
		return Array.isArray(right) ? right.every((item) => left.includes(item)) : left.includes(right);
	}
	if (
		typeof left === "object" &&
		left !== null &&
		typeof right === "object" &&
		right !== null &&
		!Array.isArray(left) &&
		!Array.isArray(right)
	) {
		return Object.entries(right).every(([key, value]) => Reflect.get(left, key) === value);
	}
	return false;
};

const aggregateDistinctKey = (value: unknown) =>
	typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);

const aggregateValues = (
	values: readonly FieldValue[],
	aggregation: AggregationSpec,
): FieldValue => {
	if (aggregation.function === "count") {
		return { kind: "number", value: values.length };
	}

	const numbers = values.flatMap((value) => (typeof value.value === "number" ? [value.value] : []));
	if (numbers.length === 0) {
		return { kind: "null", value: null };
	}

	const result = Match.value(aggregation.function).pipe(
		Match.when("sum", () => numbers.reduce((total, value) => total + value, 0)),
		Match.when(
			"average",
			() => numbers.reduce((total, value) => total + value, 0) / numbers.length,
		),
		Match.when("minimum", () => Math.min(...numbers)),
		Match.when("maximum", () => Math.max(...numbers)),
		Match.exhaustive,
	);
	return { kind: "number", value: result };
};

const evalAggregate = (
	userId: string,
	context: RowContext,
	aggregation: AggregationSpec,
	source: Source,
): Effect.Effect<FieldValue, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const matches = yield* executeSourceMatches(userId, context, source, evalExprAsBoolean);
		if (matches.length > MAX_AGGREGATE_EXPRESSION_SOURCE_ROWS) {
			return yield* new BadRequest({
				message: `Aggregate expression source matched rows exceeds maximum of ${MAX_AGGREGATE_EXPRESSION_SOURCE_ROWS}`,
			});
		}

		if (aggregation.function === "count") {
			if (aggregation.distinctBy === undefined) {
				return { kind: "number" as const, value: matches.length };
			}

			const distinct = new Set<string>();
			for (const match of matches) {
				const value = fieldValueScalar(
					yield* evalExprValue(userId, aggregation.distinctBy, match.context),
				);
				if (value !== null && value !== undefined) {
					distinct.add(aggregateDistinctKey(value));
				}
			}
			return { kind: "number" as const, value: distinct.size };
		}

		const values: number[] = [];
		for (const match of matches) {
			const value = fieldValueScalar(yield* evalExprValue(userId, aggregation.expr, match.context));
			if (typeof value === "number") {
				values.push(value);
			}
		}

		if (values.length === 0) {
			return { kind: "null" as const, value: null };
		}

		const result = Match.value(aggregation.function).pipe(
			Match.when("sum", () => values.reduce((total, value) => total + value, 0)),
			Match.when(
				"average",
				() => values.reduce((total, value) => total + value, 0) / values.length,
			),
			Match.when("minimum", () => Math.min(...values)),
			Match.when("maximum", () => Math.max(...values)),
			Match.exhaustive,
		);
		return { kind: "number" as const, value: result };
	});

export const evalExprValue = (
	userId: string,
	expr: Expr,
	context: RowContext,
): Effect.Effect<FieldValue, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		if (expr.type === "ref") {
			return evalRefInContext(expr, context);
		}
		if (expr.type === "literal") {
			return valueToFieldValue(expr.value);
		}
		if (expr.type === "exists") {
			const matches = yield* executeSourceMatches(
				userId,
				context,
				expr.source,
				evalExprAsBoolean,
				expr.source.where === null ? 1 : null,
			);
			return { kind: "boolean" as const, value: matches.length > 0 };
		}
		if (expr.type === "aggregate") {
			return yield* evalAggregate(userId, context, expr.aggregation, expr.source);
		}
		if (expr.type === "comparison") {
			const left = fieldValueScalar(yield* evalExprValue(userId, expr.left, context));
			const right = fieldValueScalar(yield* evalExprValue(userId, expr.right, context));
			return { kind: "boolean" as const, value: compareValues(left, right, expr.operator) };
		}
		if (expr.type === "and") {
			for (const value of expr.values) {
				if (!(yield* evalExprAsBoolean(userId, value, context))) {
					return { kind: "boolean" as const, value: false };
				}
			}
			return { kind: "boolean" as const, value: true };
		}
		if (expr.type === "or") {
			for (const value of expr.values) {
				if (yield* evalExprAsBoolean(userId, value, context)) {
					return { kind: "boolean" as const, value: true };
				}
			}
			return { kind: "boolean" as const, value: false };
		}
		if (expr.type === "not") {
			return {
				kind: "boolean" as const,
				value: !(yield* evalExprAsBoolean(userId, expr.expr, context)),
			};
		}
		if (expr.type === "isNull") {
			const value = fieldValueScalar(yield* evalExprValue(userId, expr.expr, context));
			return { kind: "boolean" as const, value: value === null || value === undefined };
		}
		if (expr.type === "isNotNull") {
			const value = fieldValueScalar(yield* evalExprValue(userId, expr.expr, context));
			return { kind: "boolean" as const, value: value !== null && value !== undefined };
		}
		if (expr.type === "contains") {
			const left = fieldValueScalar(yield* evalExprValue(userId, expr.left, context));
			const right = fieldValueScalar(yield* evalExprValue(userId, expr.right, context));
			return { kind: "boolean" as const, value: containsValue(left, right) };
		}
		if (expr.type === "coalesce") {
			for (const valueExpr of expr.values) {
				const value = yield* evalExprValue(userId, valueExpr, context);
				if (value.value !== null && value.value !== undefined) {
					return value;
				}
			}
			return { kind: "null" as const, value: null };
		}
		return { kind: "null" as const, value: null };
	});

export const evalExprAsBoolean = (
	userId: string,
	expr: Expr,
	context: RowContext,
): Effect.Effect<boolean, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.map(evalExprValue(userId, expr, context), (value) => value.value === true);

export const groupKeyFromValues = (values: readonly FieldValue[]) =>
	JSON.stringify(values.map((value) => [value.kind, value.value]));

const compareAggregateOrderValues = (left: unknown, right: unknown) => {
	if (left === null || left === undefined) {
		return right === null || right === undefined ? 0 : 1;
	}
	if (right === null || right === undefined) {
		return -1;
	}

	const normalizedLeft = left instanceof Date ? left.toISOString() : left;
	const normalizedRight = right instanceof Date ? right.toISOString() : right;
	if (typeof normalizedLeft === "number" && typeof normalizedRight === "number") {
		return normalizedLeft - normalizedRight;
	}
	if (typeof normalizedLeft === "string" && typeof normalizedRight === "string") {
		return normalizedLeft.localeCompare(normalizedRight);
	}
	return 0;
};

export const evalAggregateMeasure = (
	userId: string,
	matches: readonly SourceMatch[],
	aggregation: AggregationSpec,
): Effect.Effect<FieldValue, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		if (aggregation.function === "count") {
			if (aggregation.distinctBy === undefined) {
				return { kind: "number" as const, value: matches.length };
			}

			const distinct = new Set<string>();
			for (const match of matches) {
				const value = fieldValueScalar(
					yield* evalExprValue(userId, aggregation.distinctBy, match.context),
				);
				if (value !== null && value !== undefined) {
					distinct.add(aggregateDistinctKey(value));
				}
			}
			return { kind: "number" as const, value: distinct.size };
		}

		const values: FieldValue[] = [];
		for (const match of matches) {
			values.push(yield* evalExprValue(userId, aggregation.expr, match.context));
		}
		return aggregateValues(values, aggregation);
	});

export const evalAggregateGroupFields = (
	userId: string,
	groupBy: readonly FieldDef[],
	match: SourceMatch,
): Effect.Effect<FieldValue[], BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const values: FieldValue[] = [];
		for (const field of groupBy) {
			values.push(yield* evalExprValue(userId, field.expr, match.context));
		}
		return values;
	});

const aggregateOrderValue = (value: RowValue | undefined) =>
	value !== undefined && "kind" in value ? value.value : null;

export const sortAggregateItems = (
	items: readonly RowItem[],
	orderBy: AggregateOutput["orderBy"],
) => {
	const sorted = [...items];
	sorted.sort((left, right) => {
		for (const entry of orderBy ?? []) {
			if (entry.expr.type !== "measureRef") {
				continue;
			}
			const leftValue = left[entry.expr.key];
			const rightValue = right[entry.expr.key];
			const result = compareAggregateOrderValues(
				aggregateOrderValue(leftValue),
				aggregateOrderValue(rightValue),
			);
			if (result !== 0) {
				return entry.order === "asc" ? result : -result;
			}
		}
		return 0;
	});
	return sorted;
};
