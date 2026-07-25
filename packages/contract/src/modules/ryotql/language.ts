import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";

export const TableReference = strictStruct({
	alias: Schema.String,
	table: Schema.String,
}).annotate({ identifier: "RyotQLTableReference" });
export type TableReference = typeof TableReference.Type;

export const ColumnExpression = strictStruct({
	field: Schema.String,
	tableAlias: Schema.String,
	type: Schema.Literal("column"),
}).annotate({ identifier: "RyotQLColumnExpression" });
export type ColumnExpression = typeof ColumnExpression.Type;

export const LiteralExpression = strictStruct({
	value: Schema.Unknown,
	type: Schema.Literal("literal"),
}).annotate({ identifier: "RyotQLLiteralExpression" });
export type LiteralExpression = typeof LiteralExpression.Type;

export const ScalarExpression = Schema.Union([ColumnExpression, LiteralExpression]).annotate({
	identifier: "RyotQLScalarExpression",
});
export type ScalarExpression = typeof ScalarExpression.Type;

const ComparisonPredicate = strictStruct({
	left: ScalarExpression,
	right: ScalarExpression,
	operator: Schema.Literal("eq"),
	type: Schema.Literal("comparison"),
}).annotate({ identifier: "RyotQLComparisonPredicate" });

const MembershipPredicate = strictStruct({
	expr: ScalarExpression,
	type: Schema.Literal("in"),
	values: Schema.Array(ScalarExpression),
}).annotate({ identifier: "RyotQLMembershipPredicate" });

export const Predicate = Schema.Union([ComparisonPredicate, MembershipPredicate]).annotate({
	identifier: "RyotQLPredicate",
});
export type Predicate = typeof Predicate.Type;

export const Join = strictStruct({
	on: Predicate,
	table: TableReference,
	type: Schema.Literals(["inner", "left"]),
}).annotate({ identifier: "RyotQLJoin" });
export type Join = typeof Join.Type;

export const FieldSelection = strictStruct({
	key: Schema.String,
	expr: ScalarExpression,
}).annotate({ identifier: "RyotQLFieldSelection" });
export type FieldSelection = typeof FieldSelection.Type;

export const OrderBy = strictStruct({
	expr: ScalarExpression,
	direction: Schema.Literals(["asc", "desc"]),
}).annotate({ identifier: "RyotQLOrderBy" });
export type OrderBy = typeof OrderBy.Type;

const Pagination = strictStruct({
	page: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
	limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
}).annotate({ identifier: "RyotQLPagination" });

export const RowsOutput = strictStruct({
	pagination: Pagination,
	orderBy: Schema.Array(OrderBy),
	type: Schema.Literal("rows"),
	fields: Schema.Array(FieldSelection),
}).annotate({ identifier: "RyotQLRowsOutput" });
export type RowsOutput = typeof RowsOutput.Type;

export const NamedQuery = strictStruct({
	output: RowsOutput,
	from: TableReference,
	where: Schema.optional(Predicate),
	joins: Schema.optional(Schema.Array(Join)),
}).annotate({ identifier: "RyotQLNamedQuery" });
export type NamedQuery = typeof NamedQuery.Type;

export const RyotQLDocument = strictStruct({
	queries: Schema.Record(Schema.String, NamedQuery),
}).annotate({ identifier: "RyotQLDocument" });
export type RyotQLDocument = typeof RyotQLDocument.Type;

export const FieldValue = strictStruct({
	value: Schema.Unknown,
	kind: Schema.Literals(["boolean", "date", "json", "null", "number", "text"]),
}).annotate({ identifier: "RyotQLFieldValue" });
export type FieldValue = typeof FieldValue.Type;
export type RowItem = Readonly<Record<string, FieldValue>>;

const RowsPageInfo = strictStruct({
	page: Schema.Int,
	limit: Schema.Int,
	total: Schema.Int,
	hasMore: Schema.Boolean,
}).annotate({ identifier: "RyotQLRowsPageInfo" });

export const RowsResult = strictStruct({
	pageInfo: RowsPageInfo,
	type: Schema.Literal("rows"),
	items: Schema.Array(Schema.Record(Schema.String, FieldValue)),
}).annotate({ identifier: "RyotQLRowsResult" });
export type RowsResult = typeof RowsResult.Type;

export const RyotQLResponse = strictStruct({
	data: Schema.Record(Schema.String, RowsResult),
}).annotate({ identifier: "RyotQLResponse" });
export type RyotQLResponse = typeof RyotQLResponse.Type;
