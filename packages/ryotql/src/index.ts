import type {
	ColumnExpression,
	FieldSelection,
	Include,
	Join,
	JsonValue,
	LiteralExpression,
	NamedQuery,
	OrderBy,
	Predicate,
	RyotQLDocument,
	ScalarExpression,
	TableReference,
} from "@ryot/contract/modules/ryotql/language";

type CastExpression = Extract<ScalarExpression, { type: "cast" }>;
type JsonPathExpression = Extract<ScalarExpression, { type: "jsonPath" }>;
type ComparisonPredicate = Extract<Predicate, { type: "comparison" }>;

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
	...(input.joins && input.joins.length > 0
		? { joins: [...input.joins] as [Join, ...Join[]] }
		: {}),
	...(input.include && input.include.length > 0
		? { include: [...input.include] as [Include, ...Include[]] }
		: {}),
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
): NamedQuery => ({
	from,
	...(input.where ? { where: input.where } : {}),
	...(input.joins && input.joins.length > 0
		? { joins: [...input.joins] as [Join, ...Join[]] }
		: {}),
	output: {
		type: "rows",
		fields: [...input.fields],
		pagination: { page: input.page ?? 1, limit: input.limit ?? 20 },
		...(input.include && input.include.length > 0
			? { include: [...input.include] as [Include, ...Include[]] }
			: {}),
		orderBy: input.orderBy ? [...input.orderBy] : [ascending(column(from, "id"))],
	},
});

export const document = (queries: Readonly<Record<string, NamedQuery>>): RyotQLDocument => ({
	queries: { ...queries },
});
