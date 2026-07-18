import {
	queryEngineField,
	queryEngineIdentityFields,
	queryEngineOrder,
	queryEngineSystemRef,
	type QueryEngineNonEmptyArray,
} from "./primitives";

type EntitySourceInput<TWhere> = {
	alias: string;
	schemas: QueryEngineNonEmptyArray<string>;
	where?: TWhere | null | undefined;
};

export function queryEngineEntitySource<TWhere>(input: EntitySourceInput<TWhere>): {
	type: "entities";
	alias: string;
	schemas: QueryEngineNonEmptyArray<string>;
	where: TWhere | null;
};
export function queryEngineEntitySource<TWhere, TVia>(
	input: EntitySourceInput<TWhere> & { via: TVia },
): {
	type: "entities";
	alias: string;
	schemas: QueryEngineNonEmptyArray<string>;
	where: TWhere | null;
	via: TVia;
};
export function queryEngineEntitySource(input: EntitySourceInput<unknown> & { via?: unknown }) {
	const { alias, schemas, via } = input;
	const where = input.where ?? null;
	return via === undefined
		? { type: "entities" as const, alias, schemas, where }
		: { type: "entities" as const, alias, schemas, via, where };
}

export const queryEngineNestedEventSource = <TWhere>(input: {
	alias: string;
	entityRef: string;
	schemas: QueryEngineNonEmptyArray<string>;
	where?: TWhere | null | undefined;
}) => ({ type: "events" as const, ...input, where: input.where ?? null });

export const queryEngineEventRootSource = <TWhere>(input: {
	alias: string;
	entityAlias: string;
	eventSchemas: QueryEngineNonEmptyArray<string>;
	entitySchemas: QueryEngineNonEmptyArray<string>;
	where?: TWhere | null | undefined;
}) => ({
	type: "events" as const,
	alias: input.alias,
	where: input.where ?? null,
	schemas: input.eventSchemas,
	entity: { alias: input.entityAlias, schemas: input.entitySchemas },
});

export const queryEngineRelationshipSource = <TWhere>(input: {
	alias: string;
	schemas: QueryEngineNonEmptyArray<string>;
	where?: TWhere | null | undefined;
	sourceEntity: { alias: string; schemas: QueryEngineNonEmptyArray<string> };
	targetEntity: { alias: string; schemas: QueryEngineNonEmptyArray<string> };
}) => ({ type: "relationships" as const, ...input, where: input.where ?? null });

export const queryEngineInclude = <
	TSource,
	TFields extends readonly unknown[],
	TOrderBy extends QueryEngineNonEmptyArray<unknown>,
	TInclude extends readonly unknown[] | undefined = undefined,
>(input: {
	key: string;
	limit: number;
	source: TSource;
	fields: TFields;
	orderBy: TOrderBy;
	include?: TInclude | undefined;
}) => {
	const { include, ...rest } = input;
	return include === undefined ? rest : { ...rest, include };
};

export const buildQueryEngineRowsDocument = <
	TSource,
	TFields extends readonly unknown[],
	TOrderBy extends QueryEngineNonEmptyArray<unknown>,
	TInclude extends readonly unknown[] | undefined = undefined,
>(input: {
	source: TSource;
	fields: TFields;
	orderBy: TOrderBy;
	page?: number | undefined;
	limit?: number | undefined;
	include?: TInclude | undefined;
}) => {
	const { include, source, fields, orderBy, page = 1, limit = 20 } = input;
	const output =
		include === undefined
			? { type: "rows" as const, fields, orderBy, pagination: { page, limit } }
			: { type: "rows" as const, fields, orderBy, include, pagination: { page, limit } };
	return { source, output };
};

export const buildQueryEngineEntityRowsDocument = <
	TWhere,
	TFields extends readonly unknown[] | undefined = undefined,
	TOrderBy extends QueryEngineNonEmptyArray<unknown> | undefined = undefined,
	TInclude extends readonly unknown[] | undefined = undefined,
>(input: {
	alias?: string | undefined;
	schemas: QueryEngineNonEmptyArray<string>;
	where?: TWhere | null | undefined;
	fields?: TFields | undefined;
	orderBy?: TOrderBy | undefined;
	include?: TInclude | undefined;
	page?: number | undefined;
	limit?: number | undefined;
}) => {
	const alias = input.alias ?? "entity";
	const fields = input.fields ?? queryEngineIdentityFields(alias);
	const orderBy = input.orderBy ?? [queryEngineOrder("asc", queryEngineSystemRef(alias, "name"))];
	return buildQueryEngineRowsDocument({
		fields,
		orderBy,
		page: input.page,
		limit: input.limit,
		include: input.include,
		source: queryEngineEntitySource({
			alias,
			schemas: input.schemas,
			where: input.where,
		}),
	});
};

export const buildQueryEngineEventRowsDocument = <
	TWhere,
	TFields extends readonly unknown[],
	TOrderBy extends QueryEngineNonEmptyArray<unknown>,
	TInclude extends readonly unknown[] | undefined = undefined,
>(input: {
	eventAlias: string;
	entityAlias: string;
	eventSchemas: QueryEngineNonEmptyArray<string>;
	entitySchemas: QueryEngineNonEmptyArray<string>;
	where?: TWhere | null | undefined;
	fields: TFields;
	orderBy: TOrderBy;
	include?: TInclude | undefined;
	page?: number | undefined;
	limit?: number | undefined;
}) =>
	buildQueryEngineRowsDocument({
		fields: input.fields,
		orderBy: input.orderBy,
		page: input.page,
		limit: input.limit,
		include: input.include,
		source: queryEngineEventRootSource({
			alias: input.eventAlias,
			where: input.where,
			entityAlias: input.entityAlias,
			eventSchemas: input.eventSchemas,
			entitySchemas: input.entitySchemas,
		}),
	});

export const buildQueryEngineAggregateDocument = <
	TSource,
	TMeasures extends QueryEngineNonEmptyArray<unknown>,
	TGroupBy extends readonly unknown[] | undefined = undefined,
	TOrderBy extends QueryEngineNonEmptyArray<unknown> | undefined = undefined,
>(input: {
	source: TSource;
	measures: TMeasures;
	groupBy?: TGroupBy | undefined;
	orderBy?: TOrderBy | undefined;
	limit?: number | undefined;
}) => {
	const { source, ...output } = input;
	return { source, output: { type: "aggregate" as const, ...output } };
};

export const buildQueryEngineTimeSeriesDocument = <TSource, TMeasure, TTime>(input: {
	source: TSource;
	measure: TMeasure;
	time: TTime;
}) => {
	const { source, ...output } = input;
	return { source, output: { type: "timeSeries" as const, ...output } };
};

export const queryEngineFields = {
	createdAt: (alias: string) =>
		queryEngineField("createdAt", queryEngineSystemRef(alias, "createdAt")),
	externalId: (alias: string) =>
		queryEngineField("externalId", queryEngineSystemRef(alias, "externalId")),
	populatedAt: (alias: string) =>
		queryEngineField("populatedAt", queryEngineSystemRef(alias, "populatedAt")),
	properties: (alias: string) =>
		queryEngineField("properties", queryEngineSystemRef(alias, "properties")),
	updatedAt: (alias: string) =>
		queryEngineField("updatedAt", queryEngineSystemRef(alias, "updatedAt")),
};
