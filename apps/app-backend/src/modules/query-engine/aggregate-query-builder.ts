import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { match } from "ts-pattern";

import { CurrentDb, dbEffect } from "~/lib/db";
import type { DbError } from "~/lib/errors";
import type { AggregateQueryRequest } from "~/lib/query-language";

import type { PreparedQueryContext } from "./context";
import { buildBaseEntitiesCte } from "./entity-query-ctes";
import { buildJoinedEntitiesCte } from "./event-join-ctes";
import type { ExpressionCompiler } from "./expression-compiler";
import { buildFilterWhereClause } from "./filter-builder";
import {
	appendRequiredJoinFilterClause,
	buildExpressionCompiler,
	buildLatestEventJoinCtes,
	buildLatestRelationshipJoinCtes,
	buildQueryFilterClause,
	buildQueryRuntime,
	buildScalarCompiler,
} from "./query-builder-shared";
import { ENTITY_CTE_ALIASES } from "./query-cte-shared";
import { sanitizeIdentifier } from "./sql-expression-helpers";

type AggregateRow = Record<`aggregation_${number}`, unknown>;

type AggregateValue = {
	key: string;
	kind: "json" | "null" | "number";
	value: unknown;
};

const isNumberRecord = (value: unknown): value is Record<string, number> => {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((item) => typeof item === "number")
	);
};

export const mapAggregateValue = (input: {
	key: string;
	value: unknown;
	type: string;
}): AggregateValue => {
	if (input.type === "countBy") {
		const value = input.value;
		return {
			kind: "json",
			key: input.key,
			value: isNumberRecord(value) ? value : {},
		};
	}
	if (input.value === null) {
		return { kind: "null", key: input.key, value: null };
	}
	return { kind: "number", key: input.key, value: Number(input.value) };
};

export const executeAggregateQuery = (input: {
	userId: string;
	context: PreparedQueryContext;
	request: AggregateQueryRequest;
}): Effect.Effect<{ mode: "aggregate"; data: { values: AggregateValue[] } }, DbError, CurrentDb> =>
	Effect.gen(function* () {
		const runtime = buildQueryRuntime({
			userId: input.userId,
			context: input.context,
			computedFields: input.request.computedFields,
		});
		const baseEntitiesCte = buildBaseEntitiesCte({
			userId: input.userId,
			entitySchemaIds: input.context.runtimeSchemas.map((s) => s.id),
		});
		const latestEventJoinCtes = buildLatestEventJoinCtes(input.userId, input.context.eventJoins);
		const latestRelationshipJoinCtes = buildLatestRelationshipJoinCtes(
			input.userId,
			input.context.relationshipJoins,
		);
		const joinedEntitiesCte = buildJoinedEntitiesCte({
			eventJoins: input.context.eventJoins,
			relationshipJoins: input.context.relationshipJoins,
		});
		const filterWhereClause = buildQueryFilterClause({
			runtime,
			predicate: input.request.filter,
			alias: ENTITY_CTE_ALIASES.joined,
			computedFields: input.request.computedFields,
		});
		const aggregationCompiler = buildScalarCompiler({
			runtime,
			alias: ENTITY_CTE_ALIASES.filtered,
			computedFields: input.request.computedFields,
		});
		const aggregationExpressionCompiler: ExpressionCompiler = buildExpressionCompiler({
			runtime,
			alias: ENTITY_CTE_ALIASES.filtered,
			computedFields: input.request.computedFields,
		});
		const selectExpressions = input.request.aggregations.map((aggregationField, index) => {
			const columnName = `aggregation_${index}`;
			const aggregation = aggregationField.aggregation;

			const expression = match(aggregation)
				.with({ type: "count" }, () => sql`to_jsonb(count(*)::integer)`)
				.with({ type: "countWhere" }, (agg) => {
					const predicateClause = buildFilterWhereClause({
						context: runtime.queryContext,
						compiler: aggregationExpressionCompiler,
						computedFields: input.request.computedFields,
						predicate: agg.predicate,
					});
					return sql`to_jsonb(count(*) filter (where ${predicateClause})::integer)`;
				})
				.with({ type: "countBy" }, (agg) => {
					const safeAlias = sanitizeIdentifier(ENTITY_CTE_ALIASES.filtered, "table alias");
					const groupByExpression = aggregationCompiler.compile(agg.groupBy);
					return sql`coalesce((
						select jsonb_object_agg(gk, gc)
						from (
							select (${groupByExpression})::text as gk, count(*)::integer as gc
							from ${sql.raw(safeAlias)}
							group by gk
						) sub
						where gk is not null
					), '{}'::jsonb)`;
				})
				.with(
					{ type: "sum" },
					(agg) => sql`to_jsonb(sum(${aggregationCompiler.compile(agg.expression, "number")}))`,
				)
				.with(
					{ type: "avg" },
					(agg) => sql`to_jsonb(avg(${aggregationCompiler.compile(agg.expression, "number")}))`,
				)
				.with(
					{ type: "min" },
					(agg) => sql`to_jsonb(min(${aggregationCompiler.compile(agg.expression, "number")}))`,
				)
				.with(
					{ type: "max" },
					(agg) => sql`to_jsonb(max(${aggregationCompiler.compile(agg.expression, "number")}))`,
				)
				.exhaustive();

			return sql`${expression} as ${sql.raw(sanitizeIdentifier(columnName, "column alias"))}`;
		});
		const filterClause = appendRequiredJoinFilterClause(
			filterWhereClause,
			input.context.relationshipJoins,
		);
		const cteList = sql.join(
			[baseEntitiesCte, ...latestEventJoinCtes, ...latestRelationshipJoinCtes, joinedEntitiesCte],
			sql`, `,
		);

		const db = yield* CurrentDb;
		const result = yield* dbEffect(() =>
			db.execute<AggregateRow>(sql`
				with
					${cteList},
					${sql.raw(ENTITY_CTE_ALIASES.filtered)} as (
						select *
						from ${sql.raw(ENTITY_CTE_ALIASES.joined)}
						where ${filterClause}
					)
				select ${sql.join(selectExpressions, sql`, `)}
				from ${sql.raw(ENTITY_CTE_ALIASES.filtered)}
			`),
		);
		const row = result.rows[0] ?? {};

		return {
			mode: "aggregate" as const,
			data: {
				values: input.request.aggregations.map((aggregationField, index) => {
					return mapAggregateValue({
						key: aggregationField.key,
						type: aggregationField.aggregation.type,
						value: row[`aggregation_${index}`] ?? null,
					});
				}),
			},
		};
	});
