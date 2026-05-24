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

export type JsonValue =
	| null
	| string
	| number
	| boolean
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

export const JsonValue: Schema.Codec<JsonValue, JsonValue> = Schema.suspend(() =>
	Schema.Union([
		Schema.Null,
		Schema.String,
		Schema.Finite,
		Schema.Boolean,
		Schema.Array(JsonValue),
		Schema.Record(Schema.String, JsonValue),
	]),
).annotate({ identifier: "RyotQLJsonValue" });

export const LiteralExpression = strictStruct({
	value: JsonValue,
	type: Schema.Literal("literal"),
}).annotate({ identifier: "RyotQLLiteralExpression" });
export type LiteralExpression = typeof LiteralExpression.Type;

export type ScalarExpression =
	| ColumnExpression
	| LiteralExpression
	| {
			readonly type: "cast";
			readonly expr: ScalarExpression;
			readonly target: "boolean" | "date" | "json" | "number" | "text";
	  }
	| {
			readonly type: "jsonPath";
			readonly expr: ScalarExpression;
			readonly path: readonly [string | number, ...(string | number)[]];
	  }
	| {
			readonly type: "coalesce";
			readonly values: readonly [ScalarExpression, ...ScalarExpression[]];
	  };

const JsonPathSegment = Schema.Union([Schema.String, Schema.Number]);

export const ScalarExpression: Schema.Codec<ScalarExpression, unknown> = Schema.suspend(() =>
	Schema.Union([
		ColumnExpression,
		LiteralExpression,
		strictStruct({
			expr: ScalarExpression,
			type: Schema.Literal("cast"),
			target: Schema.Literals(["boolean", "date", "json", "number", "text"]),
		}),
		strictStruct({
			expr: ScalarExpression,
			type: Schema.Literal("jsonPath"),
			path: Schema.NonEmptyArray(JsonPathSegment),
		}),
		strictStruct({
			type: Schema.Literal("coalesce"),
			values: Schema.NonEmptyArray(ScalarExpression),
		}),
	]),
).annotate({ identifier: "RyotQLScalarExpression" });

export type Predicate =
	| { readonly type: "not"; readonly predicate: Predicate }
	| { readonly expr: ScalarExpression; readonly type: "isNull" }
	| { readonly expr: ScalarExpression; readonly type: "isNotNull" }
	| { readonly type: "or"; readonly predicates: readonly Predicate[] }
	| { readonly type: "and"; readonly predicates: readonly Predicate[] }
	| {
			readonly type: "in";
			readonly expr: ScalarExpression;
			readonly values: readonly ScalarExpression[];
	  }
	| { readonly left: ScalarExpression; readonly right: ScalarExpression; readonly type: "contains" }
	| {
			readonly type: "comparison";
			readonly left: ScalarExpression;
			readonly right: ScalarExpression;
			readonly operator: "eq" | "gt" | "gte" | "lt" | "lte" | "neq";
	  };

export const Predicate: Schema.Codec<Predicate, unknown> = Schema.suspend(() =>
	Schema.Union([
		strictStruct({ predicate: Predicate, type: Schema.Literal("not") }),
		strictStruct({ expr: ScalarExpression, type: Schema.Literal("isNull") }),
		strictStruct({ expr: ScalarExpression, type: Schema.Literal("isNotNull") }),
		strictStruct({ type: Schema.Literal("or"), predicates: Schema.Array(Predicate) }),
		strictStruct({ type: Schema.Literal("and"), predicates: Schema.Array(Predicate) }),
		strictStruct({
			expr: ScalarExpression,
			type: Schema.Literal("in"),
			values: Schema.Array(ScalarExpression),
		}),
		strictStruct({
			left: ScalarExpression,
			right: ScalarExpression,
			type: Schema.Literal("contains"),
		}),
		strictStruct({
			left: ScalarExpression,
			right: ScalarExpression,
			type: Schema.Literal("comparison"),
			operator: Schema.Literals(["eq", "gt", "gte", "lt", "lte", "neq"]),
		}),
	]),
).annotate({ identifier: "RyotQLPredicate" });

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
