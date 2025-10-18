import { sql } from "drizzle-orm";

import { db } from "~/lib/db";

import { buildQueryContext, type PreparedQueryContext } from "./context";
import { buildBaseEntitiesCte } from "./entity-query-ctes";
import { buildJoinedEntitiesCte, buildLatestEventJoinCte } from "./event-join-ctes";
import {
	createQueryCompiler,
	createScalarExpressionCompiler,
	type ExpressionCompiler,
} from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildFilterWhereClause } from "./filter-builder";
import { ENTITY_CTE_ALIASES } from "./query-cte-shared";
import {
	buildLatestRelationshipJoinCte,
	buildRequiredJoinWhereClause,
} from "./relationship-join-ctes";
import type {
	AggregateQueryEngineRequest,
	QueryEngineAggregateResponseData,
	QueryEngineAggregateResponse,
	QueryEngineContext,
} from "./schemas";
import { sanitizeIdentifier } from "./sql-expression-helpers";

type AggregateRow = Record<`aggregation_${number}`, unknown>;

const buildCountByAggregationExpression = (input: {
	alias: string;
	compiler: ReturnType<typeof createScalarExpressionCompiler>;
	expression: AggregateQueryEngineRequest["aggregations"][number]["aggregation"] & {
		type: "countBy";
	};
}) => {
	const safeAlias = sanitizeIdentifier(input.alias, "table alias");
	const groupByExpression = input.compiler.compile(input.expression.groupBy);

	// CountBy response keys are always strings regardless of input expression
	// type, since the SQL builder casts values to ::text for JSONB map keys.
	return sql`coalesce((
		select jsonb_object_agg(gk, gc)
		from (
			select (${groupByExpression})::text as gk, count(*)::integer as gc
			from ${sql.raw(safeAlias)}
			group by gk
		) sub
		where gk is not null
	), '{}'::jsonb)`;
};

const buildAggregationExpression = (input: {
	alias: string;
	compiler: ReturnType<typeof createScalarExpressionCompiler>;
	expressionCompiler: ExpressionCompiler;
	aggregation: AggregateQueryEngineRequest["aggregations"][number]["aggregation"];
	computedFields: AggregateQueryEngineRequest["computedFields"];
	context: QueryEngineContext;
}) => {
	if (input.aggregation.type === "count") {
		return sql`to_jsonb(count(*)::integer)`;
	}

	if (input.aggregation.type === "countWhere") {
		const predicateClause = buildFilterWhereClause({
			context: input.context,
			compiler: input.expressionCompiler,
			computedFields: input.computedFields,
			predicate: input.aggregation.predicate,
		});

		return sql`to_jsonb(count(*) filter (where ${predicateClause})::integer)`;
	}

	if (input.aggregation.type === "countBy") {
		return buildCountByAggregationExpression({
			alias: input.alias,
			compiler: input.compiler,
			expression: input.aggregation,
		});
	}

	const valueExpression = input.compiler.compile(input.aggregation.expression, "number");

	if (input.aggregation.type === "sum") {
		return sql`to_jsonb(sum(${valueExpression}))`;
	}

	if (input.aggregation.type === "avg") {
		return sql`to_jsonb(avg(${valueExpression}))`;
	}

	if (input.aggregation.type === "min") {
		return sql`to_jsonb(min(${valueExpression}))`;
	}

	return sql`to_jsonb(max(${valueExpression}))`;
};

type AggregateValue = QueryEngineAggregateResponseData["values"][number];

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
	type: AggregateQueryEngineRequest["aggregations"][number]["aggregation"]["type"];
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

export const executeAggregateQuery = async (input: {
	userId: string;
	context: PreparedQueryContext;
	request: AggregateQueryEngineRequest;
}): Promise<QueryEngineAggregateResponse> => {
	const queryContext = buildQueryContext(input.userId, input.context);
	const getTypeInfo = createExpressionTypeResolver({
		context: queryContext,
		computedFields: input.request.computedFields,
	});
	const baseEntitiesCte = buildBaseEntitiesCte({
		userId: input.userId,
		entitySchemaIds: input.context.runtimeSchemas.map((schema) => schema.id),
	});
	const latestEventJoinCtes = input.context.eventJoins.map((join) => {
		return buildLatestEventJoinCte({ join, userId: input.userId });
	});
	const latestRelationshipJoinCtes = input.context.relationshipJoins.map((join) => {
		return buildLatestRelationshipJoinCte({ join, userId: input.userId });
	});
	const joinedEntitiesCte = buildJoinedEntitiesCte({
		eventJoins: input.context.eventJoins,
		relationshipJoins: input.context.relationshipJoins,
	});
	const filterCompiler = createQueryCompiler({
		getTypeInfo,
		context: queryContext,
		alias: ENTITY_CTE_ALIASES.joined,
		computedFields: input.request.computedFields,
	});
	const filterWhereClause = buildFilterWhereClause({
		context: queryContext,
		compiler: filterCompiler,
		predicate: input.request.filter,
		computedFields: input.request.computedFields,
	});
	const aggregationCompiler = createScalarExpressionCompiler({
		getTypeInfo,
		context: queryContext,
		alias: ENTITY_CTE_ALIASES.filtered,
		computedFields: input.request.computedFields,
	});
	const aggregationExpressionCompiler = createQueryCompiler({
		getTypeInfo,
		context: queryContext,
		alias: ENTITY_CTE_ALIASES.filtered,
		computedFields: input.request.computedFields,
	});
	const selectExpressions = input.request.aggregations.map((aggregationField, index) => {
		const columnName = `aggregation_${index}`;
		const expression = buildAggregationExpression({
			context: queryContext,
			compiler: aggregationCompiler,
			alias: ENTITY_CTE_ALIASES.filtered,
			aggregation: aggregationField.aggregation,
			computedFields: input.request.computedFields,
			expressionCompiler: aggregationExpressionCompiler,
		});

		return sql`${expression} as ${sql.raw(sanitizeIdentifier(columnName, "column alias"))}`;
	});
	const requiredJoinClause = buildRequiredJoinWhereClause(input.context.relationshipJoins);
	const filterClause = requiredJoinClause
		? sql`${filterWhereClause} and ${requiredJoinClause}`
		: filterWhereClause;
	const cteList = sql.join(
		[baseEntitiesCte, ...latestEventJoinCtes, ...latestRelationshipJoinCtes, joinedEntitiesCte],
		sql`, `,
	);
	const result = await db.execute<AggregateRow>(sql`
		with
			${cteList},
			${sql.raw(ENTITY_CTE_ALIASES.filtered)} as (
				select *
				from ${sql.raw(ENTITY_CTE_ALIASES.joined)}
				where ${filterClause}
			)
		select ${sql.join(selectExpressions, sql`, `)}
		from ${sql.raw(ENTITY_CTE_ALIASES.filtered)}
	`);
	const row = result.rows[0] ?? {};

	return {
		mode: "aggregate",
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
};
