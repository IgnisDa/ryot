import { sql } from "drizzle-orm";
import { db } from "~/lib/db";
import type {
	QueryEngineEventJoinLike,
	QueryEngineReferenceContext,
} from "~/lib/views/reference";
import { createScalarExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildFilterWhereClause } from "./filter-builder";
import {
	buildBaseEntitiesCte,
	buildJoinedEntitiesCte,
	buildLatestEventJoinCte,
	type QueryEngineSchemaRow,
} from "./query-ctes";
import type {
	AggregateQueryEngineRequest,
	QueryEngineAggregateResponse,
	ResolvedDisplayValue,
} from "./schemas";

type AggregateRow = Record<string, unknown>;

const buildCountByAggregationExpression = (input: {
	alias: string;
	compiler: ReturnType<typeof createScalarExpressionCompiler>;
	expression: AggregateQueryEngineRequest["aggregations"][number]["aggregation"] & {
		type: "countBy";
	};
}) => {
	const groupByExpression = input.compiler.compile(input.expression.groupBy);

	return sql`coalesce((
		select jsonb_object_agg(gk, gc)
		from (
			select (${groupByExpression})::text as gk, count(*)::integer as gc
			from ${sql.raw(input.alias)}
			group by gk
		) sub
		where gk is not null
	), '{}'::jsonb)`;
};

const buildAggregationExpression = (input: {
	alias: string;
	compiler: ReturnType<typeof createScalarExpressionCompiler>;
	aggregation: AggregateQueryEngineRequest["aggregations"][number]["aggregation"];
	computedFields: AggregateQueryEngineRequest["computedFields"];
	context: QueryEngineReferenceContext<
		QueryEngineSchemaRow,
		QueryEngineEventJoinLike
	>;
}) => {
	if (input.aggregation.type === "count") {
		return sql`to_jsonb(count(*)::integer)`;
	}

	if (input.aggregation.type === "countWhere") {
		const predicateClause = buildFilterWhereClause({
			alias: input.alias,
			context: input.context,
			computedFields: input.computedFields,
			predicate: input.aggregation.predicate,
		});

		return sql`to_jsonb(count(*) filter (where ${predicateClause ?? sql`true`})::integer)`;
	}

	if (input.aggregation.type === "countBy") {
		return buildCountByAggregationExpression({
			alias: input.alias,
			compiler: input.compiler,
			expression: input.aggregation,
		});
	}

	const valueExpression = input.compiler.compile(
		input.aggregation.expression,
		"number",
	);

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

type AggregateValue = {
	key: string;
	value: unknown;
	kind: ResolvedDisplayValue["kind"];
};

export const mapAggregateValue = (input: {
	key: string;
	value: unknown;
	type: AggregateQueryEngineRequest["aggregations"][number]["aggregation"]["type"];
}): AggregateValue => {
	if (input.type === "countBy") {
		return { kind: "json", key: input.key, value: input.value ?? {} };
	}
	if (input.value === null) {
		return { kind: "null", key: input.key, value: null };
	}
	return { kind: "number", key: input.key, value: input.value };
};

export const executeAggregateQuery = async (input: {
	userId: string;
	relationshipSchemaIds: string[];
	request: AggregateQueryEngineRequest;
	runtimeSchemas: QueryEngineSchemaRow[];
	eventJoins: QueryEngineEventJoinLike[];
	schemaMap: Map<string, QueryEngineSchemaRow>;
	eventJoinMap: Map<string, QueryEngineEventJoinLike>;
}): Promise<QueryEngineAggregateResponse> => {
	const context: QueryEngineReferenceContext<
		QueryEngineSchemaRow,
		QueryEngineEventJoinLike
	> = {
		userId: input.userId,
		schemaMap: input.schemaMap,
		eventJoinMap: input.eventJoinMap,
	};
	const baseEntitiesCte = buildBaseEntitiesCte({
		userId: input.userId,
		relationshipSchemaIds: input.relationshipSchemaIds,
		entitySchemaIds: input.runtimeSchemas.map((schema) => schema.id),
	});
	const latestEventJoinCtes = input.eventJoins.map((join) => {
		return buildLatestEventJoinCte({ join, userId: input.userId });
	});
	const joinedEntitiesCte = buildJoinedEntitiesCte(input.eventJoins);
	const filterWhereClause = buildFilterWhereClause({
		context,
		alias: "joined_entities",
		predicate: input.request.filter,
		computedFields: input.request.computedFields,
	});
	const getTypeInfo = createExpressionTypeResolver({
		context,
		computedFields: input.request.computedFields,
	});
	const compiler = createScalarExpressionCompiler({
		context,
		getTypeInfo,
		alias: "filtered_entities",
		computedFields: input.request.computedFields,
	});
	const selectExpressions = input.request.aggregations.map(
		(aggregationField, index) => {
			const columnName = `aggregation_${index}`;
			const expression = buildAggregationExpression({
				context,
				compiler,
				alias: "filtered_entities",
				computedFields: input.request.computedFields,
				aggregation: aggregationField.aggregation,
			});

			return sql`${expression} as ${sql.raw(columnName)}`;
		},
	);
	const filterClause = filterWhereClause ?? sql`true`;
	const cteList = sql.join(
		[baseEntitiesCte, ...latestEventJoinCtes, joinedEntitiesCte],
		sql`, `,
	);
	const result = await db.execute<AggregateRow>(sql`
		with
			${cteList},
			filtered_entities as (
				select *
				from joined_entities
				where ${filterClause}
			)
		select ${sql.join(selectExpressions, sql`, `)}
		from filtered_entities
	`);
	const row = result.rows[0] ?? {};

	return {
		mode: "aggregate",
		data: {
			values: input.request.aggregations.map((aggregationField, index) => {
				return mapAggregateValue({
					key: aggregationField.key,
					value: row[`aggregation_${index}`] ?? null,
					type: aggregationField.aggregation.type,
				});
			}),
		},
	};
};
