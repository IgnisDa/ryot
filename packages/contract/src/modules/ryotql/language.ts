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

const JsonPrimitive = Schema.Union([Schema.Null, Schema.String, Schema.Finite, Schema.Boolean]);

export type JsonValue =
	| readonly JsonValue[]
	| typeof JsonPrimitive.Type
	| { readonly [key: string]: JsonValue };

export const JsonValue: Schema.Codec<JsonValue, JsonValue> = Schema.suspend(() =>
	Schema.Union([JsonPrimitive, Schema.Array(JsonValue), Schema.Record(Schema.String, JsonValue)]),
).annotate({ identifier: "RyotQLJsonValue" });

export const LiteralExpression = strictStruct({
	value: JsonValue,
	type: Schema.Literal("literal"),
}).annotate({ identifier: "RyotQLLiteralExpression" });
export type LiteralExpression = typeof LiteralExpression.Type;

const JsonPathSegment = Schema.Union([Schema.String, Schema.Number]);
const CastTarget = Schema.Literals(["boolean", "date", "json", "number", "text"]);
const JsonPath = Schema.NonEmptyArray(JsonPathSegment);

export type ScalarExpression =
	| ColumnExpression
	| LiteralExpression
	| {
			readonly type: "cast";
			readonly expr: ScalarExpression;
			readonly target: typeof CastTarget.Type;
	  }
	| {
			readonly type: "jsonPath";
			readonly expr: ScalarExpression;
			readonly path: typeof JsonPath.Type;
	  }
	| {
			readonly type: "coalesce";
			readonly values: readonly [ScalarExpression, ...ScalarExpression[]];
	  };

export const ScalarExpression: Schema.Codec<ScalarExpression, unknown> = Schema.suspend(() =>
	Schema.Union([
		ColumnExpression,
		LiteralExpression,
		strictStruct({
			target: CastTarget,
			expr: ScalarExpression,
			type: Schema.Literal("cast"),
		}),
		strictStruct({
			path: JsonPath,
			expr: ScalarExpression,
			type: Schema.Literal("jsonPath"),
		}),
		strictStruct({
			type: Schema.Literal("coalesce"),
			values: Schema.NonEmptyArray(ScalarExpression),
		}),
	]),
).annotate({ identifier: "RyotQLScalarExpression" });

const IsNullPredicate = strictStruct({
	expr: ScalarExpression,
	type: Schema.Literal("isNull"),
});

const IsNotNullPredicate = strictStruct({
	expr: ScalarExpression,
	type: Schema.Literal("isNotNull"),
});

const InPredicate = strictStruct({
	expr: ScalarExpression,
	type: Schema.Literal("in"),
	values: Schema.Array(ScalarExpression),
});

const ContainsPredicate = strictStruct({
	left: ScalarExpression,
	right: ScalarExpression,
	type: Schema.Literal("contains"),
});

const ComparisonOperator = Schema.Literals(["eq", "gt", "gte", "lt", "lte", "neq"]);

const ComparisonPredicate = strictStruct({
	left: ScalarExpression,
	right: ScalarExpression,
	operator: ComparisonOperator,
	type: Schema.Literal("comparison"),
});

export type Predicate =
	| typeof InPredicate.Type
	| typeof IsNullPredicate.Type
	| typeof ContainsPredicate.Type
	| typeof IsNotNullPredicate.Type
	| typeof ComparisonPredicate.Type
	| { readonly type: "not"; readonly predicate: Predicate }
	| { readonly type: "or"; readonly predicates: readonly Predicate[] }
	| { readonly type: "and"; readonly predicates: readonly Predicate[] };

export const Predicate: Schema.Codec<Predicate, unknown> = Schema.suspend(() =>
	Schema.Union([
		InPredicate,
		IsNullPredicate,
		ContainsPredicate,
		IsNotNullPredicate,
		ComparisonPredicate,
		strictStruct({ predicate: Predicate, type: Schema.Literal("not") }),
		strictStruct({ type: Schema.Literal("or"), predicates: Schema.Array(Predicate) }),
		strictStruct({ type: Schema.Literal("and"), predicates: Schema.Array(Predicate) }),
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

export type Include = {
	readonly key: string;
	readonly limit: number;
	readonly from: TableReference;
	readonly where?: Predicate | undefined;
	readonly fields: readonly FieldSelection[];
	readonly orderBy: readonly [OrderBy, ...OrderBy[]];
	readonly joins?: readonly [Join, ...Join[]] | undefined;
	readonly include?: readonly [Include, ...Include[]] | undefined;
};

export const Include: Schema.Codec<Include, unknown> = Schema.suspend(() =>
	strictStruct({
		key: Schema.String,
		from: TableReference,
		where: Schema.optional(Predicate),
		fields: Schema.Array(FieldSelection),
		orderBy: Schema.NonEmptyArray(OrderBy),
		joins: Schema.optional(Schema.NonEmptyArray(Join)),
		include: Schema.optional(Schema.NonEmptyArray(Include)),
		limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
	}),
).annotate({ identifier: "RyotQLInclude" });

const Pagination = strictStruct({
	page: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
	limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
}).annotate({ identifier: "RyotQLPagination" });

export const RowsOutput = strictStruct({
	pagination: Pagination,
	orderBy: Schema.Array(OrderBy),
	type: Schema.Literal("rows"),
	fields: Schema.Array(FieldSelection),
	include: Schema.optional(Schema.NonEmptyArray(Include)),
}).annotate({ identifier: "RyotQLRowsOutput" });
export type RowsOutput = typeof RowsOutput.Type;

export const NamedQuery = strictStruct({
	output: RowsOutput,
	from: TableReference,
	where: Schema.optional(Predicate),
	joins: Schema.optional(Schema.NonEmptyArray(Join)),
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

const IncludePageInfo = strictStruct({
	limit: Schema.Int,
	hasMore: Schema.Boolean,
}).annotate({ identifier: "RyotQLIncludePageInfo" });

export type IncludeResult = {
	readonly items: readonly RowItem[];
	readonly pageInfo: typeof IncludePageInfo.Type;
};
export type RowItem = Readonly<Record<string, FieldValue | IncludeResult>>;

const RowValue: Schema.Codec<FieldValue | IncludeResult, unknown> = Schema.suspend(() =>
	Schema.Union([
		FieldValue,
		strictStruct({
			pageInfo: IncludePageInfo,
			items: Schema.Array(Schema.Record(Schema.String, RowValue)),
		}),
	]),
).annotate({ identifier: "RyotQLRowValue" });

const RowsPageInfo = strictStruct({
	page: Schema.Int,
	limit: Schema.Int,
	total: Schema.Int,
	hasMore: Schema.Boolean,
}).annotate({ identifier: "RyotQLRowsPageInfo" });

export const RowsResult = strictStruct({
	pageInfo: RowsPageInfo,
	type: Schema.Literal("rows"),
	items: Schema.Array(Schema.Record(Schema.String, RowValue)),
}).annotate({ identifier: "RyotQLRowsResult" });
export type RowsResult = typeof RowsResult.Type;

export const RyotQLResponse = strictStruct({
	data: Schema.Record(Schema.String, RowsResult),
}).annotate({ identifier: "RyotQLResponse" });
export type RyotQLResponse = typeof RyotQLResponse.Type;
