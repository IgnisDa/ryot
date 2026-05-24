import type {
	ColumnExpression,
	FieldSelection,
	Join,
	LiteralExpression,
	NamedQuery,
	OrderBy,
	Predicate,
	RyotQLDocument,
	ScalarExpression,
	TableReference,
} from "@ryot/contract/modules/ryotql/language";

export const table = (tableName: string, alias: string): TableReference => ({
	alias,
	table: tableName,
});

export const column = (tableName: TableReference, field: string): ColumnExpression => ({
	field,
	type: "column",
	tableAlias: tableName.alias,
});

export const literal = (value: unknown): LiteralExpression => ({ type: "literal", value });

export const eq = (left: ScalarExpression, right: ScalarExpression): Predicate => ({
	left,
	right,
	operator: "eq",
	type: "comparison",
});

export const inArray = (
	expr: ScalarExpression,
	values: readonly ScalarExpression[],
): Predicate => ({ expr, type: "in", values: [...values] });

export const field = (key: string, expr: ScalarExpression): FieldSelection => ({ expr, key });

export const ascending = (expr: ScalarExpression): OrderBy => ({ direction: "asc", expr });

export const descending = (expr: ScalarExpression): OrderBy => ({ direction: "desc", expr });

export const join = (type: Join["type"], tableName: TableReference, on: Predicate): Join => ({
	on,
	type,
	table: tableName,
});

export const rows = (
	from: TableReference,
	input: {
		readonly page?: number | undefined;
		readonly limit?: number | undefined;
		readonly where?: Predicate | undefined;
		readonly fields: readonly FieldSelection[];
		readonly joins?: readonly Join[] | undefined;
		readonly orderBy?: readonly OrderBy[] | undefined;
	},
): NamedQuery => ({
	from,
	...(input.where ? { where: input.where } : {}),
	...(input.joins && input.joins.length > 0 ? { joins: [...input.joins] } : {}),
	output: {
		type: "rows",
		fields: [...input.fields],
		pagination: { page: input.page ?? 1, limit: input.limit ?? 20 },
		orderBy: input.orderBy ? [...input.orderBy] : [ascending(column(from, "id"))],
	},
});

export const document = (queries: Readonly<Record<string, NamedQuery>>): RyotQLDocument => ({
	queries: { ...queries },
});
