export type QueryEngineNonEmptyArray<T> = readonly [T, ...T[]];

export const queryEngineArithmeticOperators = ["add", "subtract", "multiply", "divide"] as const;
export type QueryEngineArithmeticOperator = (typeof queryEngineArithmeticOperators)[number];

export const queryEngineComparisonOperators = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
export type QueryEngineComparisonOperator = (typeof queryEngineComparisonOperators)[number];

export const queryEngineField = <TExpr>(key: string, expr: TExpr) => ({ key, expr });

export const queryEngineOrder = <TExpr>(order: "asc" | "desc", expr: TExpr) => ({ order, expr });

export const queryEngineSystemRef = (sourceAlias: string, name: string) => ({
	type: "ref" as const,
	sourceAlias,
	field: { type: "system" as const, name },
});

export const queryEnginePropertyRef = (
	sourceAlias: string,
	schema: string,
	...path: [string, ...string[]]
) => ({
	type: "ref" as const,
	sourceAlias,
	field: { type: "property" as const, schema, path },
});

export const queryEngineSchemaRef = (sourceAlias: string, name: "slug" | "name") => ({
	type: "ref" as const,
	sourceAlias,
	field: { type: "schema" as const, name },
});

export const queryEngineComputedRef = (sourceAlias: string, name: "translationStatus") => ({
	type: "ref" as const,
	sourceAlias,
	field: { type: "systemComputed" as const, name },
});

export const queryEngineMeasureRef = (key: string) => ({ type: "measureRef" as const, key });

export function queryEngineLiteral<TValue>(value: TValue): { type: "literal"; value: TValue };
export function queryEngineLiteral<TValue>(
	value: TValue,
	valueType: "date",
): { type: "literal"; value: TValue; valueType: "date" };
export function queryEngineLiteral<TValue>(value: TValue, valueType?: "date") {
	return valueType === undefined
		? { type: "literal" as const, value }
		: { type: "literal" as const, value, valueType };
}

export const queryEngineComparison = <TLeft, TRight>(
	operator: QueryEngineComparisonOperator,
	left: TLeft,
	right: TRight,
) => ({ type: "comparison" as const, operator, left, right });

export const queryEngineArithmetic = <TLeft, TRight>(
	operator: QueryEngineArithmeticOperator,
	left: TLeft,
	right: TRight,
) => ({ type: "arithmetic" as const, operator, left, right });

export const queryEngineNot = <TExpr>(expr: TExpr) => ({ type: "not" as const, expr });

export const queryEngineIsNull = <TExpr>(expr: TExpr) => ({ type: "isNull" as const, expr });

export const queryEngineIsNotNull = <TExpr>(expr: TExpr) => ({ type: "isNotNull" as const, expr });

export const queryEngineContains = <TLeft, TRight>(left: TLeft, right: TRight) => ({
	type: "contains" as const,
	left,
	right,
});

export const queryEngineAnd = <TValues extends QueryEngineNonEmptyArray<unknown>>(
	...values: TValues
) => ({
	type: "and" as const,
	values,
});

export const queryEngineOr = <TValues extends QueryEngineNonEmptyArray<unknown>>(
	...values: TValues
) => ({
	type: "or" as const,
	values,
});

export const queryEngineAndOrNull = <TExpr>(values: readonly TExpr[]) => {
	const [first, ...rest] = values;
	if (first === undefined) {
		return null;
	}
	return rest.length === 0 ? first : queryEngineAnd(first, ...rest);
};

export const queryEngineCoalesce = <TValues extends QueryEngineNonEmptyArray<unknown>>(
	...values: TValues
) => ({
	type: "coalesce" as const,
	values,
});

export const queryEngineExists = <TSource>(source: TSource) => ({
	type: "exists" as const,
	source,
});

export const queryEngineAggregate = <TSource, TAggregation>(
	source: TSource,
	aggregation: TAggregation,
) => ({ type: "aggregate" as const, source, aggregation });

export const queryEngineFirst = <
	TSource,
	TSelect,
	TOrderBy extends QueryEngineNonEmptyArray<unknown>,
>(input: {
	source: TSource;
	select: TSelect;
	orderBy: TOrderBy;
}) => ({ type: "first" as const, ...input });

export const queryEngineIdentityFields = (alias: string) =>
	[
		queryEngineField("id", queryEngineSystemRef(alias, "id")),
		queryEngineField("name", queryEngineSystemRef(alias, "name")),
		queryEngineField("schemaSlug", queryEngineSchemaRef(alias, "slug")),
	] as const;
