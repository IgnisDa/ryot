import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";

import type { FieldSelector, RowItem, RowValue } from "../language";
import {
	evalAggregateGroupFields,
	evalAggregateMeasure,
	evalExprAsBoolean,
	groupKeyFromValues,
	sortAggregateItems,
} from "./expr";
import { reconstructGroupFieldValue, reconstructMeasureValue } from "./field-values";
import { executeRootSourceMatches, rootSourceFromWhereSql } from "./source-matches";
import {
	aggregateOrderBySql,
	groupFieldSql,
	measureAggregationSql,
	rootAliasResolver,
	rootWherePushdown,
} from "./sql";
import type { AggregateQueryDocument, RootAliasKind } from "./types";

type SqlFragment = ReturnType<typeof sql>;
type AggregateMeasurePlan = { readonly key: string; readonly sql: SqlFragment };
type AggregateGroupPlan = {
	readonly key: string;
	readonly sql: SqlFragment;
	readonly kind: RootAliasKind;
	readonly field: FieldSelector;
};
type AggregateSqlPlan =
	| {
			readonly type: "ungrouped";
			readonly conditions: readonly SqlFragment[];
			readonly measures: readonly AggregateMeasurePlan[];
	  }
	| {
			readonly type: "grouped";
			readonly limit: number;
			readonly orderBy: SqlFragment;
			readonly conditions: readonly SqlFragment[];
			readonly groups: readonly AggregateGroupPlan[];
			readonly measures: readonly AggregateMeasurePlan[];
	  };

// Compiles an aggregate return into SQL when every construct has identical semantics in the
// database, otherwise returns null so the caller keeps the app-side path. Bails when the source
// `where` leaves an app-side residual, a groupBy is not a plain field ref, or a measure cannot be
// pushed (count-distinct and non-numeric-property operands stay app-side).
const planAggregateSql = (doc: AggregateQueryDocument, userId: string): AggregateSqlPlan | null => {
	const { source, output } = doc;
	const pushdown = rootWherePushdown(source, userId);
	if (pushdown.residual !== null) {
		return null;
	}
	const resolve = rootAliasResolver(source);

	const measures: AggregateMeasurePlan[] = [];
	const measureKeyToIndex = new Map<string, number>();
	for (const measure of output.measures) {
		const measureSql = measureAggregationSql(measure.aggregation, resolve);
		if (!measureSql) {
			return null;
		}
		measureKeyToIndex.set(measure.key, measures.length);
		measures.push({ key: measure.key, sql: measureSql });
	}

	const groupBy = output.groupBy ?? [];
	if (groupBy.length === 0) {
		return { type: "ungrouped", conditions: pushdown.conditions, measures };
	}

	const groups: AggregateGroupPlan[] = [];
	for (const group of groupBy) {
		if (group.expr.type !== "ref") {
			return null;
		}
		const target = resolve(group.expr.sourceAlias);
		if (!target) {
			return null;
		}
		const columnSql = groupFieldSql(group.expr.field, target);
		if (!columnSql) {
			return null;
		}
		groups.push({ key: group.key, sql: columnSql, kind: target.kind, field: group.expr.field });
	}

	// Validation guarantees a grouped return carries limit + measureRef orderBy; bail otherwise.
	if (output.limit === undefined || output.orderBy === undefined) {
		return null;
	}
	const orderBy = aggregateOrderBySql(output.orderBy, measureKeyToIndex);
	if (!orderBy) {
		return null;
	}
	return {
		type: "grouped",
		conditions: pushdown.conditions,
		groups,
		measures,
		orderBy,
		limit: output.limit,
	};
};

const aliasedSql = (fragment: SqlFragment, prefix: string, index: number) =>
	sql`${fragment} AS ${sql.raw(`"${prefix}${index}"`)}`;

const executeAggregateSql = Effect.fn("executeAggregateSql")(function* (
	userId: string,
	doc: AggregateQueryDocument,
	plan: AggregateSqlPlan,
) {
	const fromWhere = yield* rootSourceFromWhereSql(userId, doc.source, plan.conditions);
	const db = yield* CurrentDb;
	const measureSelect = plan.measures.map((measure, index) => aliasedSql(measure.sql, "m", index));

	if (plan.type === "ungrouped") {
		const rawRows = yield* dbEffect(() =>
			db.execute(sql`SELECT ${sql.join(measureSelect, sql`, `)} ${fromWhere}`),
		);
		const row = rawRows.rows[0] ?? {};
		const item: Record<string, RowValue> = {};
		for (const [index, measure] of plan.measures.entries()) {
			item[measure.key] = reconstructMeasureValue(row[`m${index}`]);
		}
		return { type: "aggregate" as const, data: { items: [item] } };
	}

	const groupSelect = plan.groups.map((group, index) => aliasedSql(group.sql, "g", index));
	// Group by the leading select columns' ordinals: re-embedding each group expression would give
	// it fresh bind-parameter positions, which Postgres treats as a different expression from the
	// SELECT column and then rejects ("must appear in the GROUP BY clause").
	const groupBySql = sql.join(
		plan.groups.map((_, index) => sql.raw(String(index + 1))),
		sql`, `,
	);
	const rawRows = yield* dbEffect(() =>
		db.execute(sql`
				SELECT
					${sql.join([...groupSelect, ...measureSelect], sql`, `)},
					COUNT(*) OVER() AS "totalGroups"
				${fromWhere}
				GROUP BY ${groupBySql}
				ORDER BY ${plan.orderBy}
				LIMIT ${plan.limit}
			`),
	);

	const items: RowItem[] = rawRows.rows.map((row) => {
		const item: Record<string, RowValue> = {};
		for (const [index, group] of plan.groups.entries()) {
			item[group.key] = reconstructGroupFieldValue(group.field, group.kind, row[`g${index}`]);
		}
		for (const [index, measure] of plan.measures.entries()) {
			item[measure.key] = reconstructMeasureValue(row[`m${index}`]);
		}
		return item;
	});
	const totalGroups = rawRows.rows[0] ? Number(rawRows.rows[0].totalGroups) : 0;
	return {
		type: "aggregate" as const,
		data: { items, pageInfo: { limit: plan.limit, hasMore: totalGroups > plan.limit } },
	};
});

const executeAggregateInApp = Effect.fn("executeAggregateInApp")(function* (
	userId: string,
	doc: AggregateQueryDocument,
) {
	const { output } = doc;
	const matches = yield* executeRootSourceMatches(userId, doc.source, evalExprAsBoolean);
	const groupBy = output.groupBy ?? [];

	if (groupBy.length === 0) {
		const item: Record<string, RowValue> = {};
		for (const measure of output.measures) {
			item[measure.key] = yield* evalAggregateMeasure(userId, matches, measure.aggregation);
		}
		return { type: "aggregate" as const, data: { items: [item] } };
	}

	const groups = new Map<string, { item: Record<string, RowValue>; matches: typeof matches }>();
	for (const match of matches) {
		const groupValues = yield* evalAggregateGroupFields(userId, groupBy, match);
		const groupKey = groupKeyFromValues(groupValues);
		const existing = groups.get(groupKey);
		if (existing !== undefined) {
			existing.matches.push(match);
			continue;
		}

		const item: Record<string, RowValue> = {};
		for (const [index, field] of groupBy.entries()) {
			const value = groupValues[index];
			if (value !== undefined) {
				item[field.key] = value;
			}
		}
		groups.set(groupKey, { item, matches: [match] });
	}

	const items: RowItem[] = [];
	for (const group of groups.values()) {
		for (const measure of output.measures) {
			group.item[measure.key] = yield* evalAggregateMeasure(
				userId,
				group.matches,
				measure.aggregation,
			);
		}
		items.push(group.item);
	}

	const sortedItems = sortAggregateItems(items, output.orderBy);
	const limit = output.limit ?? sortedItems.length;
	return {
		type: "aggregate" as const,
		data: {
			items: sortedItems.slice(0, limit),
			pageInfo: { limit, hasMore: sortedItems.length > limit },
		},
	};
});

export const executeAggregateQuery = Effect.fn("executeAggregateQuery")(function* (
	userId: string,
	doc: AggregateQueryDocument,
) {
	const plan = planAggregateSql(doc, userId);
	return plan
		? yield* executeAggregateSql(userId, doc, plan)
		: yield* executeAggregateInApp(userId, doc);
});
