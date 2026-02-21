import {
	queryEngineComparison,
	queryEngineField,
	queryEngineIdentityFields,
	queryEngineLiteral,
	queryEngineOrder,
	queryEngineSchemaRef,
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

type QueryEngineRowsOutput<
	TFields,
	TOrderBy,
	TInclude extends readonly unknown[] | undefined,
> = TInclude extends readonly unknown[]
	? {
			type: "rows";
			fields: TFields;
			orderBy: TOrderBy;
			include: TInclude;
			pagination: { page: number; limit: number };
		}
	: {
			type: "rows";
			fields: TFields;
			orderBy: TOrderBy;
			pagination: { page: number; limit: number };
		};

export function buildQueryEngineRowsDocument<
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
}): { source: TSource; output: QueryEngineRowsOutput<TFields, TOrderBy, TInclude> };
export function buildQueryEngineRowsDocument(input: {
	source: unknown;
	fields: readonly unknown[];
	orderBy: readonly unknown[];
	page?: number | undefined;
	limit?: number | undefined;
	include?: readonly unknown[] | undefined;
}) {
	const { include, source, fields, orderBy, page = 1, limit = 20 } = input;
	const output =
		include === undefined
			? { type: "rows" as const, fields, orderBy, pagination: { page, limit } }
			: { type: "rows" as const, fields, orderBy, include, pagination: { page, limit } };
	return { source, output };
}

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
	id: (alias: string) => queryEngineField("id", queryEngineSystemRef(alias, "id")),
	name: (alias: string) => queryEngineField("name", queryEngineSystemRef(alias, "name")),
	createdAt: (alias: string) =>
		queryEngineField("createdAt", queryEngineSystemRef(alias, "createdAt")),
	externalId: (alias: string) =>
		queryEngineField("externalId", queryEngineSystemRef(alias, "externalId")),
	entitySchemaSlug: (alias: string) =>
		queryEngineField("entitySchemaSlug", queryEngineSystemRef(alias, "entitySchemaSlug")),
	populatedAt: (alias: string) =>
		queryEngineField("populatedAt", queryEngineSystemRef(alias, "populatedAt")),
	providerId: (alias: string) =>
		queryEngineField("providerId", queryEngineSystemRef(alias, "providerId")),
	properties: (alias: string) =>
		queryEngineField("properties", queryEngineSystemRef(alias, "properties")),
	eventSchemaName: (alias: string) =>
		queryEngineField("eventSchemaName", queryEngineSchemaRef(alias, "name")),
	eventSchemaSlug: (alias: string) =>
		queryEngineField("eventSchemaSlug", queryEngineSchemaRef(alias, "slug")),
	entityId: (alias: string) =>
		queryEngineField("entityId", queryEngineSystemRef(alias, "entityId")),
	occurredAt: (alias: string) =>
		queryEngineField("occurredAt", queryEngineSystemRef(alias, "occurredAt")),
	sessionEntityId: (alias: string) =>
		queryEngineField("sessionEntityId", queryEngineSystemRef(alias, "sessionEntityId")),
	updatedAt: (alias: string) =>
		queryEngineField("updatedAt", queryEngineSystemRef(alias, "updatedAt")),
};

export const queryEngineEntityIdEquals = (alias: string, entityId: string) =>
	queryEngineComparison("eq", queryEngineSystemRef(alias, "id"), queryEngineLiteral(entityId));
