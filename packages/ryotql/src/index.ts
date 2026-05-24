import type {
	AggregateMeasure,
	AggregateOrderBy,
	AggregateOutput,
	AggregationSpec,
	ColumnExpression,
	CorrelatedQuerySet,
	ExistsExpression,
	FieldSelection,
	Include,
	Join,
	JsonValue,
	LiteralExpression,
	NamedQuery,
	OrderBy,
	Predicate,
	RyotQLDocument,
	RowsOutput,
	ScalarExpression,
	TableReference,
} from "@ryot/contract/modules/ryotql/language";

type CastExpression = Extract<ScalarExpression, { type: "cast" }>;
type FirstExpression = Extract<ScalarExpression, { type: "first" }>;
type AggregateExpression = Extract<ScalarExpression, { type: "aggregate" }>;
type ArithmeticExpression = Extract<ScalarExpression, { type: "arithmetic" }>;
type JsonPathExpression = Extract<ScalarExpression, { type: "jsonPath" }>;
type ComparisonPredicate = Extract<Predicate, { type: "comparison" }>;
type CorrelatedQueryInput = {
	readonly where?: Predicate | undefined;
	readonly joins?: readonly Join[] | undefined;
};

const isNonEmpty = <T>(values: readonly T[] | undefined): values is readonly [T, ...T[]] =>
	values !== undefined && values.length > 0;

export const table = (tableName: string, alias: string): TableReference => ({
	alias,
	table: tableName,
});

export const column = (tableName: TableReference, field: string): ColumnExpression => ({
	field,
	type: "column",
	tableAlias: tableName.alias,
});

const assertFiniteNumbers = (value: JsonValue) => {
	if (typeof value === "number" && !Number.isFinite(value)) {
		throw new TypeError("RyotQL literals require finite numbers");
	}
	if (Array.isArray(value)) {
		value.forEach(assertFiniteNumbers);
	} else if (value !== null && typeof value === "object") {
		Object.values(value).forEach(assertFiniteNumbers);
	}
};

export const literal = (value: JsonValue): LiteralExpression => {
	assertFiniteNumbers(value);
	return { type: "literal", value };
};

export const jsonPath = (
	expr: ScalarExpression,
	...path: JsonPathExpression["path"]
): JsonPathExpression => ({ expr, path, type: "jsonPath" });

const cast = (target: CastExpression["target"], expr: ScalarExpression): CastExpression => ({
	expr,
	target,
	type: "cast",
});

export const castText = (expr: ScalarExpression) => cast("text", expr);
export const castDate = (expr: ScalarExpression) => cast("date", expr);
export const castJson = (expr: ScalarExpression) => cast("json", expr);
export const castNumber = (expr: ScalarExpression) => cast("number", expr);
export const castBoolean = (expr: ScalarExpression) => cast("boolean", expr);

export const coalesce = (
	first: ScalarExpression,
	...rest: readonly ScalarExpression[]
): Extract<ScalarExpression, { type: "coalesce" }> => ({
	type: "coalesce",
	values: [first, ...rest],
});

const arithmetic = (
	operator: ArithmeticExpression["operator"],
	left: ScalarExpression,
	right: ScalarExpression,
): ArithmeticExpression => ({ left, right, operator, type: "arithmetic" });

export const add = (left: ScalarExpression, right: ScalarExpression) =>
	arithmetic("add", left, right);
export const divide = (left: ScalarExpression, right: ScalarExpression) =>
	arithmetic("divide", left, right);
export const multiply = (left: ScalarExpression, right: ScalarExpression) =>
	arithmetic("multiply", left, right);
export const subtract = (left: ScalarExpression, right: ScalarExpression) =>
	arithmetic("subtract", left, right);

const comparison = (
	operator: ComparisonPredicate["operator"],
	left: ScalarExpression,
	right: ScalarExpression,
): ComparisonPredicate => ({ left, right, operator, type: "comparison" });

export const eq = (left: ScalarExpression, right: ScalarExpression) =>
	comparison("eq", left, right);
export const gt = (left: ScalarExpression, right: ScalarExpression) =>
	comparison("gt", left, right);
export const gte = (left: ScalarExpression, right: ScalarExpression) =>
	comparison("gte", left, right);
export const lt = (left: ScalarExpression, right: ScalarExpression) =>
	comparison("lt", left, right);
export const lte = (left: ScalarExpression, right: ScalarExpression) =>
	comparison("lte", left, right);
export const neq = (left: ScalarExpression, right: ScalarExpression) =>
	comparison("neq", left, right);

export const inArray = (
	expr: ScalarExpression,
	values: readonly ScalarExpression[],
): Predicate => ({ expr, type: "in", values: [...values] });

export const contains = (left: ScalarExpression, right: ScalarExpression): Predicate => ({
	left,
	right,
	type: "contains",
});

export const isNull = (expr: ScalarExpression): Predicate => ({ expr, type: "isNull" });
export const isNotNull = (expr: ScalarExpression): Predicate => ({ expr, type: "isNotNull" });
export const not = (predicate: Predicate): Predicate => ({ predicate, type: "not" });
export const and = (...predicates: readonly Predicate[]): Predicate => ({
	type: "and",
	predicates: [...predicates],
});
export const or = (...predicates: readonly Predicate[]): Predicate => ({
	type: "or",
	predicates: [...predicates],
});

export const field = (key: string, expr: ScalarExpression): FieldSelection => ({ expr, key });

export const ascending = (expr: ScalarExpression): OrderBy => ({ direction: "asc", expr });

export const descending = (expr: ScalarExpression): OrderBy => ({ direction: "desc", expr });

export const join = (type: Join["type"], tableName: TableReference, on: Predicate): Join => ({
	on,
	type,
	table: tableName,
});

const correlatedQuery = (
	from: TableReference,
	input: CorrelatedQueryInput,
): CorrelatedQuerySet => ({
	from,
	...(input.where ? { where: input.where } : {}),
	...(isNonEmpty(input.joins) ? { joins: [...input.joins] } : {}),
});

export const exists = (
	from: TableReference,
	input: CorrelatedQueryInput = {},
): ExistsExpression => ({ type: "exists", query: correlatedQuery(from, input) });

export const first = (
	from: TableReference,
	input: CorrelatedQueryInput & {
		readonly select: ScalarExpression;
		readonly orderBy: readonly [OrderBy, ...OrderBy[]];
	},
): FirstExpression => ({
	type: "first",
	select: input.select,
	query: correlatedQuery(from, input),
	orderBy: [...input.orderBy] as [OrderBy, ...OrderBy[]],
});

const correlatedAggregate = (
	from: TableReference,
	aggregation: AggregationSpec,
	input: CorrelatedQueryInput,
): AggregateExpression => ({ aggregation, type: "aggregate", query: correlatedQuery(from, input) });

export const count = (from: TableReference, input: CorrelatedQueryInput = {}) =>
	correlatedAggregate(from, { function: "count" }, input);
export const countDistinct = (
	from: TableReference,
	expr: ScalarExpression,
	input: CorrelatedQueryInput = {},
) => correlatedAggregate(from, { expr, function: "countDistinct" }, input);
export const sum = (
	from: TableReference,
	expr: ScalarExpression,
	input: CorrelatedQueryInput = {},
) => correlatedAggregate(from, { expr, function: "sum" }, input);
export const average = (
	from: TableReference,
	expr: ScalarExpression,
	input: CorrelatedQueryInput = {},
) => correlatedAggregate(from, { expr, function: "average" }, input);
export const minimum = (
	from: TableReference,
	expr: ScalarExpression,
	input: CorrelatedQueryInput = {},
) => correlatedAggregate(from, { expr, function: "minimum" }, input);
export const maximum = (
	from: TableReference,
	expr: ScalarExpression,
	input: CorrelatedQueryInput = {},
) => correlatedAggregate(from, { expr, function: "maximum" }, input);

export const measure = (key: string, aggregation: AggregationSpec): AggregateMeasure => ({
	key,
	aggregation,
});

export const measureAscending = (key: string): AggregateOrderBy => ({ direction: "asc", key });
export const measureDescending = (key: string): AggregateOrderBy => ({ direction: "desc", key });

export const include = (
	from: TableReference,
	input: {
		readonly key: string;
		readonly limit: number;
		readonly where?: Predicate | undefined;
		readonly fields: readonly FieldSelection[];
		readonly joins?: readonly Join[] | undefined;
		readonly include?: readonly Include[] | undefined;
		readonly orderBy: readonly [OrderBy, ...OrderBy[]];
	},
): Include => ({
	from,
	key: input.key,
	limit: input.limit,
	fields: [...input.fields],
	...(input.where ? { where: input.where } : {}),
	orderBy: [...input.orderBy] as [OrderBy, ...OrderBy[]],
	...(isNonEmpty(input.joins) ? { joins: [...input.joins] } : {}),
	...(isNonEmpty(input.include) ? { include: [...input.include] } : {}),
});

export const rows = (
	from: TableReference,
	input: {
		readonly page?: number | undefined;
		readonly limit?: number | undefined;
		readonly where?: Predicate | undefined;
		readonly fields: readonly FieldSelection[];
		readonly joins?: readonly Join[] | undefined;
		readonly include?: readonly Include[] | undefined;
		readonly orderBy?: readonly OrderBy[] | undefined;
	},
): NamedQuery & { readonly output: RowsOutput } => ({
	from,
	...(input.where ? { where: input.where } : {}),
	...(isNonEmpty(input.joins) ? { joins: [...input.joins] } : {}),
	output: {
		type: "rows",
		fields: [...input.fields],
		pagination: { page: input.page ?? 1, limit: input.limit ?? 20 },
		...(isNonEmpty(input.include) ? { include: [...input.include] } : {}),
		orderBy: input.orderBy ? [...input.orderBy] : [ascending(column(from, "id"))],
	},
});

export const aggregate = (
	from: TableReference,
	input: {
		readonly limit?: number | undefined;
		readonly where?: Predicate | undefined;
		readonly joins?: readonly Join[] | undefined;
		readonly groupBy?: readonly FieldSelection[] | undefined;
		readonly measures: readonly [AggregateMeasure, ...AggregateMeasure[]];
		readonly orderBy?: readonly [AggregateOrderBy, ...AggregateOrderBy[]] | undefined;
	},
): NamedQuery & { readonly output: AggregateOutput } => ({
	from,
	...(input.where ? { where: input.where } : {}),
	...(isNonEmpty(input.joins) ? { joins: [...input.joins] } : {}),
	output: {
		type: "aggregate",
		measures: [...input.measures] as [AggregateMeasure, ...AggregateMeasure[]],
		...(input.limit !== undefined ? { limit: input.limit } : {}),
		...(input.groupBy && input.groupBy.length > 0 ? { groupBy: [...input.groupBy] } : {}),
		...(input.orderBy && input.orderBy.length > 0
			? { orderBy: [...input.orderBy] as [AggregateOrderBy, ...AggregateOrderBy[]] }
			: {}),
	},
});

export const document = <const Queries extends Readonly<Record<string, NamedQuery>>>(
	queries: Queries,
) => ({ queries: { ...queries } }) satisfies RyotQLDocument;
