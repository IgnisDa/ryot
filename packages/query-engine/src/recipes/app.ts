import {
	buildQueryEngineEntityRowsDocument,
	buildQueryEngineEventRowsDocument,
	queryEngineFields,
} from "../documents";
import {
	queryEngineAnd,
	queryEngineComparison,
	queryEngineComputedRef,
	queryEngineField,
	queryEngineIdentityFields,
	queryEngineLiteral,
	queryEngineOrder,
	queryEngineOr,
	queryEngineSchemaRef,
	queryEngineSystemRef,
	type QueryEngineNonEmptyArray,
} from "../primitives";

const entityAlias = "entity";
const eventAlias = "event";

const entityIdEquals = (entityId: string) =>
	queryEngineComparison(
		"eq",
		queryEngineSystemRef(entityAlias, "id"),
		queryEngineLiteral(entityId),
	);

const combineFilters = <TExpr>(filters: readonly TExpr[]) => {
	const [first, ...rest] = filters;
	if (first === undefined) {
		return null;
	}
	return rest.length === 0 ? first : queryEngineAnd(first, ...rest);
};

export const buildEntityDetailQueryDocument = (input: {
	entityId: string;
	entitySchemaSlug: string;
}) =>
	buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		limit: 1,
		schemas: [input.entitySchemaSlug],
		where: entityIdEquals(input.entityId),
		fields: [
			...queryEngineIdentityFields(entityAlias),
			queryEngineFields.createdAt(entityAlias),
			queryEngineFields.updatedAt(entityAlias),
			queryEngineFields.properties(entityAlias),
			queryEngineFields.externalId(entityAlias),
			queryEngineFields.populatedAt(entityAlias),
			queryEngineField("entitySchemaSlug", queryEngineSystemRef(entityAlias, "entitySchemaSlug")),
			queryEngineField("providerId", queryEngineSystemRef(entityAlias, "providerId")),
			queryEngineField(
				"translationStatus",
				queryEngineComputedRef(entityAlias, "translationStatus"),
			),
		],
		orderBy: [queryEngineOrder("asc", queryEngineSystemRef(entityAlias, "id"))],
	});

export const buildEntityInterestQueryDocument = (input: {
	entityIds: QueryEngineNonEmptyArray<string>;
	entitySchemaSlugs: QueryEngineNonEmptyArray<string>;
}) => {
	const [firstEntityId, ...restEntityIds] = input.entityIds;
	const where =
		restEntityIds.length === 0
			? entityIdEquals(firstEntityId)
			: queryEngineOr(entityIdEquals(firstEntityId), ...restEntityIds.map(entityIdEquals));

	return buildQueryEngineEntityRowsDocument({
		alias: entityAlias,
		limit: input.entityIds.length,
		schemas: input.entitySchemaSlugs,
		where,
		fields: [
			...queryEngineIdentityFields(entityAlias),
			queryEngineFields.populatedAt(entityAlias),
			queryEngineFields.externalId(entityAlias),
			queryEngineFields.properties(entityAlias),
			queryEngineField("entitySchemaSlug", queryEngineSystemRef(entityAlias, "entitySchemaSlug")),
			queryEngineField("providerId", queryEngineSystemRef(entityAlias, "providerId")),
			queryEngineField(
				"translationStatus",
				queryEngineComputedRef(entityAlias, "translationStatus"),
			),
		],
		orderBy: [queryEngineOrder("asc", queryEngineSystemRef(entityAlias, "id"))],
	});
};

export const buildEventHistoryQueryDocument = (input: {
	page: number;
	eventSchemaSlugs: QueryEngineNonEmptyArray<string>;
	entitySchemaSlugs: QueryEngineNonEmptyArray<string>;
	entityId?: string | undefined;
	sessionEntityId?: string | undefined;
	limit?: number | undefined;
}) => {
	const filters = [
		...(input.entityId
			? [
					queryEngineComparison(
						"eq",
						queryEngineSystemRef(eventAlias, "entityId"),
						queryEngineLiteral(input.entityId),
					),
				]
			: []),
		...(input.sessionEntityId
			? [
					queryEngineComparison(
						"eq",
						queryEngineSystemRef(eventAlias, "sessionEntityId"),
						queryEngineLiteral(input.sessionEntityId),
					),
				]
			: []),
	];

	return buildQueryEngineEventRowsDocument({
		page: input.page,
		limit: input.limit ?? 100,
		eventAlias,
		entityAlias,
		where: combineFilters(filters),
		eventSchemas: input.eventSchemaSlugs,
		entitySchemas: input.entitySchemaSlugs,
		fields: [
			queryEngineField("id", queryEngineSystemRef(eventAlias, "id")),
			queryEngineField("entityId", queryEngineSystemRef(eventAlias, "entityId")),
			queryEngineField("createdAt", queryEngineSystemRef(eventAlias, "createdAt")),
			queryEngineField("updatedAt", queryEngineSystemRef(eventAlias, "updatedAt")),
			queryEngineField("occurredAt", queryEngineSystemRef(eventAlias, "occurredAt")),
			queryEngineField("properties", queryEngineSystemRef(eventAlias, "properties")),
			queryEngineField("eventSchemaName", queryEngineSchemaRef(eventAlias, "name")),
			queryEngineField("eventSchemaSlug", queryEngineSchemaRef(eventAlias, "slug")),
			queryEngineField("sessionEntityId", queryEngineSystemRef(eventAlias, "sessionEntityId")),
		],
		orderBy: [
			queryEngineOrder("desc", queryEngineSystemRef(eventAlias, "occurredAt")),
			queryEngineOrder("desc", queryEngineSystemRef(eventAlias, "createdAt")),
			queryEngineOrder("desc", queryEngineSystemRef(eventAlias, "id")),
		],
	});
};

export const buildDefaultSavedViewQueryDocument = <
	TOrderBy extends QueryEngineNonEmptyArray<unknown> | undefined,
>(input: {
	orderBy?: TOrderBy;
	page?: number | undefined;
	limit?: number | undefined;
	schemas: QueryEngineNonEmptyArray<string>;
}) =>
	buildQueryEngineEntityRowsDocument({
		where: null,
		page: input.page,
		limit: input.limit,
		alias: entityAlias,
		schemas: input.schemas,
		orderBy: input.orderBy,
		fields: queryEngineIdentityFields(entityAlias),
	});
