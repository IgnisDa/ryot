import { sql } from "drizzle-orm";

import { buildQueryContext, type PreparedQueryContext } from "./context";
import { buildResolvedFieldsExpression } from "./display-builder";
import { buildLatestEventJoinCte } from "./event-join-ctes";
import {
	createQueryCompiler,
	createScalarExpressionCompiler,
	type ExpressionCompiler,
} from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";
import { buildFilterWhereClause } from "./filter-builder";
import {
	buildLatestRelationshipJoinCte,
	buildRequiredJoinWhereClause,
} from "./relationship-join-ctes";
import type {
	EntityQueryEngineRequest,
	QueryEngineContext,
	QueryEngineField,
	QueryEngineRequest,
} from "./schemas";
import { buildSortExpression } from "./sort-builder";
import type { SqlExpression } from "./sql-expression-helpers";

type QueryRuntimeInput = {
	userId: string;
	context: PreparedQueryContext;
	overrides?: Partial<QueryEngineContext>;
	computedFields: QueryEngineRequest["computedFields"];
};

export const buildQueryRuntime = (input: QueryRuntimeInput) => {
	const queryContext = buildQueryContext(input.userId, input.context, input.overrides);
	const getTypeInfo = createExpressionTypeResolver({
		context: queryContext,
		computedFields: input.computedFields,
	});

	return { getTypeInfo, queryContext };
};

export const buildLatestEventJoinCtes = (
	userId: string,
	eventJoins: PreparedQueryContext["eventJoins"],
) => {
	return eventJoins.map((join) => buildLatestEventJoinCte({ join, userId }));
};

export const buildLatestRelationshipJoinCtes = (
	userId: string,
	relationshipJoins: PreparedQueryContext["relationshipJoins"],
) => {
	return relationshipJoins.map((join) => buildLatestRelationshipJoinCte({ join, userId }));
};

type QueryRuntime = ReturnType<typeof buildQueryRuntime>;

type QueryExpressionInput = {
	alias: string;
	runtime: QueryRuntime;
	computedFields: QueryEngineRequest["computedFields"];
};

export const buildExpressionCompiler = (input: QueryExpressionInput): ExpressionCompiler => {
	return createQueryCompiler({
		alias: input.alias,
		context: input.runtime.queryContext,
		computedFields: input.computedFields,
		getTypeInfo: input.runtime.getTypeInfo,
	});
};

export const buildScalarCompiler = (input: QueryExpressionInput) => {
	return createScalarExpressionCompiler({
		alias: input.alias,
		context: input.runtime.queryContext,
		computedFields: input.computedFields,
		getTypeInfo: input.runtime.getTypeInfo,
	});
};

export const buildQueryFilterClause = (
	input: QueryExpressionInput & { predicate: QueryEngineRequest["filter"] },
) => {
	return buildFilterWhereClause({
		predicate: input.predicate,
		context: input.runtime.queryContext,
		computedFields: input.computedFields,
		compiler: buildExpressionCompiler(input),
	});
};

export const buildQuerySortExpression = (
	input: QueryExpressionInput & {
		expression: EntityQueryEngineRequest["sort"]["expression"];
	},
) => {
	return buildSortExpression({
		expression: input.expression,
		context: input.runtime.queryContext,
		computedFields: input.computedFields,
		compiler: buildExpressionCompiler(input),
	});
};

export const buildQueryResolvedFields = (input: {
	alias: string;
	runtime: QueryRuntime;
	fields: QueryEngineField[];
	computedFields: QueryEngineRequest["computedFields"];
}) => {
	return buildResolvedFieldsExpression({
		alias: input.alias,
		fields: input.fields,
		context: input.runtime.queryContext,
		computedFields: input.computedFields,
		getTypeInfo: input.runtime.getTypeInfo,
	});
};

export const appendRequiredJoinFilterClause = (
	filterClause: SqlExpression,
	relationshipJoins: PreparedQueryContext["relationshipJoins"],
) => {
	const requiredJoinClause = buildRequiredJoinWhereClause(relationshipJoins);
	return requiredJoinClause ? sql`${filterClause} and ${requiredJoinClause}` : filterClause;
};

export const resolveRequestedEventSchemaSlugs = (
	requested: string[] | undefined,
	available: ReadonlySet<string>,
) => {
	return requested?.length ? requested : [...available];
};

export const buildSortDirection = (
	direction: EntityQueryEngineRequest["sort"]["direction"],
): SqlExpression => {
	return sql.raw(direction.toUpperCase());
};
