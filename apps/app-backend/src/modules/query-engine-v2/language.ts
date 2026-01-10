import { Schema } from "effect";

import { strictStruct } from "#lib/schema/utils";

const SystemFieldSelector = strictStruct({
	name: Schema.String,
	type: Schema.Literal("system"),
}).annotations({ identifier: "SystemFieldSelector" });

const PropertyFieldSelector = strictStruct({
	schema: Schema.String,
	type: Schema.Literal("property"),
	path: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "PropertyFieldSelector" });

const SchemaMetadataFieldSelector = strictStruct({
	type: Schema.Literal("schema"),
	name: Schema.Literal("slug", "name"),
}).annotations({ identifier: "SchemaMetadataFieldSelector" });

export const FieldSelector = Schema.Union(
	SystemFieldSelector,
	PropertyFieldSelector,
	SchemaMetadataFieldSelector,
).annotations({ identifier: "FieldSelector" });
export type FieldSelector = typeof FieldSelector.Type;

export type Expr =
	| { readonly type: "not"; readonly expr: Expr }
	| { readonly type: "isNull"; readonly expr: Expr }
	| { readonly type: "isNotNull"; readonly expr: Expr }
	| { readonly type: "or"; readonly values: readonly [Expr, ...Expr[]] }
	| { readonly type: "and"; readonly values: readonly [Expr, ...Expr[]] }
	| { readonly type: "contains"; readonly left: Expr; readonly right: Expr }
	| { readonly type: "coalesce"; readonly values: readonly [Expr, ...Expr[]] }
	| { readonly type: "literal"; readonly value: unknown; readonly valueType?: "date" }
	| { readonly type: "ref"; readonly sourceAlias: string; readonly field: FieldSelector }
	| {
			readonly left: Expr;
			readonly right: Expr;
			readonly type: "comparison";
			readonly operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
	  };

const LiteralExpr = strictStruct({
	value: Schema.Unknown,
	type: Schema.Literal("literal"),
	valueType: Schema.optional(Schema.Literal("date")),
}).annotations({ identifier: "LiteralExpr" });

const RefExpr = strictStruct({
	field: FieldSelector,
	sourceAlias: Schema.String,
	type: Schema.Literal("ref"),
}).annotations({ identifier: "RefExpr" });

export const Expr: Schema.Schema<Expr> = Schema.suspend(() =>
	Schema.Union(
		RefExpr,
		LiteralExpr,
		strictStruct({ expr: Expr, type: Schema.Literal("not") }),
		strictStruct({ expr: Expr, type: Schema.Literal("isNull") }),
		strictStruct({ expr: Expr, type: Schema.Literal("isNotNull") }),
		strictStruct({ left: Expr, right: Expr, type: Schema.Literal("contains") }),
		strictStruct({ type: Schema.Literal("or"), values: Schema.NonEmptyArray(Expr) }),
		strictStruct({ type: Schema.Literal("and"), values: Schema.NonEmptyArray(Expr) }),
		strictStruct({ type: Schema.Literal("coalesce"), values: Schema.NonEmptyArray(Expr) }),
		strictStruct({
			left: Expr,
			right: Expr,
			type: Schema.Literal("comparison"),
			operator: Schema.Literal("eq", "neq", "gt", "gte", "lt", "lte"),
		}),
	),
).annotations({ identifier: "Expr" });

export const EntitySourceV2 = strictStruct({
	alias: Schema.String,
	where: Schema.NullOr(Expr),
	type: Schema.Literal("entities"),
	schemas: Schema.NonEmptyArray(Schema.String),
}).annotations({ identifier: "EntitySourceV2" });
export type EntitySourceV2 = typeof EntitySourceV2.Type;

const Pagination = strictStruct({
	page: Schema.Int.pipe(Schema.positive()),
	limit: Schema.Int.pipe(Schema.positive()),
}).annotations({ identifier: "Pagination" });

const OrderByEntry = strictStruct({ expr: Expr, order: Schema.Literal("asc", "desc") }).annotations(
	{ identifier: "OrderByEntry" },
);

const FieldDef = strictStruct({ expr: Expr, key: Schema.String }).annotations({
	identifier: "FieldDef",
});

export const RowsReturnV2 = strictStruct({
	pagination: Pagination,
	type: Schema.Literal("rows"),
	fields: Schema.Array(FieldDef),
	orderBy: Schema.NonEmptyArray(OrderByEntry),
}).annotations({ identifier: "RowsReturnV2" });
export type RowsReturnV2 = typeof RowsReturnV2.Type;

export const QueryDocumentV2 = strictStruct({
	return: RowsReturnV2,
	source: EntitySourceV2,
	version: Schema.Literal(2),
}).annotations({ identifier: "QueryDocumentV2" });
export type QueryDocumentV2 = typeof QueryDocumentV2.Type;

export const FieldValue = strictStruct({
	value: Schema.Unknown,
	kind: Schema.Literal("boolean", "date", "image", "json", "null", "number", "text"),
}).annotations({ identifier: "FieldValue" });
export type FieldValue = typeof FieldValue.Type;

const RowsPageInfo = strictStruct({
	page: Schema.Int,
	limit: Schema.Int,
	total: Schema.Int,
	hasMore: Schema.Boolean,
}).annotations({ identifier: "RowsPageInfo" });

export const RowsResponseV2 = strictStruct({
	type: Schema.Literal("rows"),
	data: strictStruct({
		pageInfo: RowsPageInfo,
		items: Schema.Array(Schema.Record({ key: Schema.String, value: FieldValue })),
	}),
}).annotations({ identifier: "RowsResponseV2" });
export type RowsResponseV2 = typeof RowsResponseV2.Type;

export const QueryResponseV2 = RowsResponseV2;
export type QueryResponseV2 = typeof QueryResponseV2.Type;
