import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db/service";

import { compileBool } from "./compile/expr";
import { rootScope } from "./compile/scope";
import {
	aggregateOrderBySql,
	groupColumnsSql,
	measureColumnsSql,
	reconstructAggregateItem,
} from "./compile/select-list";
import { rootSourceFromWhereSql } from "./root-source";
import type { AggregateQueryDocument } from "./types";

// Executes an aggregate return entirely in SQL: grouping, aggregation, ordering and the group-count
// window all run in Postgres. The source `where` compiles to a single boolean condition.
export const executeAggregateQuery = Effect.fn("executeAggregateQuery")(function* (
	userId: string,
	language: string | null,
	doc: AggregateQueryDocument,
) {
	const { source, output } = doc;
	const scope = rootScope(source, userId, language);
	const conditions = source.where ? [compileBool(source.where, scope)] : [];
	const fromWhere = yield* rootSourceFromWhereSql(userId, language, source, conditions);
	const db = yield* CurrentDb;

	const measures = output.measures;
	const measureCols = measureColumnsSql(measures, scope);
	const groupBy = output.groupBy ?? [];

	if (groupBy.length === 0) {
		const rawRows = yield* dbEffect(() => db.execute(sql`SELECT ${measureCols} ${fromWhere}`));
		const item = reconstructAggregateItem(rawRows.rows[0] ?? {}, [], measures);
		return { type: "aggregate" as const, data: { items: [item] } };
	}

	// Validation guarantees a grouped return carries a limit and a measureRef orderBy.
	if (output.limit === undefined || output.orderBy === undefined) {
		return yield* Effect.dieMessage("Grouped aggregate is missing limit/orderBy after validation");
	}
	const groups = groupColumnsSql(groupBy, scope);
	const measureKeyToIndex = new Map(measures.map((measure, index) => [measure.key, index]));
	const orderBy = aggregateOrderBySql(output.orderBy, measureKeyToIndex);
	const limit = output.limit;

	const rawRows = yield* dbEffect(() =>
		db.execute(sql`
			SELECT
				${groups.columns},
				${measureCols},
				COUNT(*) OVER() AS "totalGroups"
			${fromWhere}
			GROUP BY ${groups.groupBy}
			ORDER BY ${orderBy}
			LIMIT ${limit}
		`),
	);

	const items = rawRows.rows.map((row) => reconstructAggregateItem(row, groupBy, measures));
	const totalGroups = rawRows.rows[0] ? Number(rawRows.rows[0].totalGroups) : 0;
	return {
		type: "aggregate" as const,
		data: { items, pageInfo: { limit, hasMore: totalGroups > limit } },
	};
});
