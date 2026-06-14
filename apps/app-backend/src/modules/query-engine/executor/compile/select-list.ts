import { sql } from "drizzle-orm";

import type {
	AggregateMeasureDef,
	AggregationSpec,
	Expr,
	FieldDef,
	RowItem,
	RowValue,
} from "../../language";
import { reconstructMeasureValue, reconstructOutputValue } from "../reconstruct";
import { compileScalar, compileValue } from "./expr";
import type { SqlFragment } from "./fragments";
import type { CompileScope } from "./scope";

type OrderByEntry = { readonly order: "asc" | "desc"; readonly expr: Expr };

// A double-quoted SQL identifier for a (possibly user-provided) output key.
const colAlias = (name: string): SqlFragment => sql.raw(`"${name.replace(/"/g, '""')}"`);

// A single-quoted SQL string literal — used for jsonb_build_object keys, which as bound params
// would have no type context ("could not determine data type of parameter").
const textLiteral = (value: string): SqlFragment => sql.raw(`'${value.replace(/'/g, "''")}'`);

// Each output field becomes two columns: `<key>__v` (jsonb value) and `<key>__k` (text kind), which
// reconstructOutputValue maps back to a FieldValue.
export const outputColumnsSql = (fields: readonly FieldDef[], scope: CompileScope): SqlFragment =>
	sql.join(
		fields.flatMap((field) => {
			const compiled = compileValue(field.expr, scope);
			return [
				sql`${compiled.value} AS ${colAlias(`${field.key}__v`)}`,
				sql`${compiled.kind} AS ${colAlias(`${field.key}__k`)}`,
			];
		}),
		sql`, `,
	);

// The `'<key>__v', value, '<key>__k', kind` entries for a jsonb_build_object, used to materialize
// include child rows inside jsonb_agg. Reconstructed by reconstructRowItem the same as flat columns.
export const jsonbFieldEntriesSql = (
	fields: readonly FieldDef[],
	scope: CompileScope,
): SqlFragment =>
	sql.join(
		fields.flatMap((field) => {
			const compiled = compileValue(field.expr, scope);
			return [
				textLiteral(`${field.key}__v`),
				compiled.value,
				textLiteral(`${field.key}__k`),
				compiled.kind,
			];
		}),
		sql`, `,
	);

export const reconstructRowItem = (
	row: Record<string, unknown>,
	fields: readonly FieldDef[],
): Record<string, RowValue> => {
	const item: Record<string, RowValue> = {};
	for (const field of fields) {
		item[field.key] = reconstructOutputValue(row[`${field.key}__v`], row[`${field.key}__k`]);
	}
	return item;
};

// A root-level aggregate measure (aggregates over the query's FROM, not a correlated subquery).
export const measureExprSql = (aggregation: AggregationSpec, scope: CompileScope): SqlFragment => {
	if (aggregation.function === "count") {
		if (aggregation.distinctBy === undefined) {
			return sql`COUNT(*)`;
		}
		return sql`COUNT(DISTINCT ${compileValue(aggregation.distinctBy, scope).value})`;
	}
	const fn =
		aggregation.function === "sum"
			? sql`SUM`
			: aggregation.function === "average"
				? sql`AVG`
				: aggregation.function === "minimum"
					? sql`MIN`
					: sql`MAX`;
	return sql`${fn}(${compileScalar(aggregation.expr, scope, "number")})`;
};

export const measureColumnsSql = (
	measures: readonly AggregateMeasureDef[],
	scope: CompileScope,
): SqlFragment =>
	sql.join(
		measures.map(
			(measure, index) =>
				sql`${measureExprSql(measure.aggregation, scope)} AS ${colAlias(`m${index}`)}`,
		),
		sql`, `,
	);

// Group keys as (value, kind) column pairs, plus the `GROUP BY` ordinal list. Group columns lead the
// SELECT list, so grouping by their ordinals avoids re-parameterizing the group expressions.
export const groupColumnsSql = (
	groupBy: readonly FieldDef[],
	scope: CompileScope,
): { columns: SqlFragment; groupBy: SqlFragment } => {
	const columns = sql.join(
		groupBy.flatMap((group, index) => {
			const compiled = compileValue(group.expr, scope);
			return [
				sql`${compiled.value} AS ${colAlias(`g${index}__v`)}`,
				sql`${compiled.kind} AS ${colAlias(`g${index}__k`)}`,
			];
		}),
		sql`, `,
	);
	const ordinals = groupBy.flatMap((_, index) => [index * 2 + 1, index * 2 + 2]);
	const groupByList = sql.join(
		ordinals.map((ordinal) => sql.raw(String(ordinal))),
		sql`, `,
	);
	return { columns, groupBy: groupByList };
};

// Grouped-aggregate ORDER BY references measure aliases (m0, m1, ...); Postgres default null
// ordering (ASC NULLS LAST / DESC NULLS FIRST) applies.
export const aggregateOrderBySql = (
	orderBy: readonly OrderByEntry[],
	measureKeyToIndex: ReadonlyMap<string, number>,
): SqlFragment => {
	const parts = orderBy.flatMap((entry) => {
		if (entry.expr.type !== "measureRef") {
			return [];
		}
		const index = measureKeyToIndex.get(entry.expr.key);
		if (index === undefined) {
			return [];
		}
		return [sql`${colAlias(`m${index}`)} ${entry.order === "asc" ? sql`ASC` : sql`DESC`}`];
	});
	return sql.join(parts, sql`, `);
};

export const reconstructAggregateItem = (
	row: Record<string, unknown>,
	groupBy: readonly FieldDef[],
	measures: readonly AggregateMeasureDef[],
): RowItem => {
	const item: Record<string, RowValue> = {};
	groupBy.forEach((group, index) => {
		item[group.key] = reconstructOutputValue(row[`g${index}__v`], row[`g${index}__k`]);
	});
	measures.forEach((measure, index) => {
		item[measure.key] = reconstructMeasureValue(row[`m${index}`]);
	});
	return item;
};
