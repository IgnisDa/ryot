import {
	buildQueryEngineEntityRowsDocument,
	buildQueryEngineEventRowsDocument,
	queryEngineEntityIdEquals,
	queryEngineFields,
} from "../documents";
import {
	queryEngineAndOrNull,
	queryEngineComparison,
	queryEngineComputedRef,
	queryEngineField,
	queryEngineIdentityFields,
	queryEngineLiteral,
	queryEngineOrder,
	queryEngineOr,
	queryEngineSystemRef,
	type QueryEngineNonEmptyArray,
} from "../primitives";

const entityAlias = "entity";
const eventAlias = "event";

const combineFilters = <TExpr>(filters: readonly TExpr[]) => {
	return queryEngineAndOrNull(filters);
};

export const buildEntityDetailQueryDocument = (input: {
	entityId: string;
	entitySchemaSlug: string;
}) =>
	buildQueryEngineEntityRowsDocument({
		limit: 1,
		alias: entityAlias,
		schemas: [input.entitySchemaSlug],
		where: queryEngineEntityIdEquals(entityAlias, input.entityId),
		orderBy: [queryEngineOrder("asc", queryEngineSystemRef(entityAlias, "id"))],
		fields: [
			...queryEngineIdentityFields(entityAlias),
			queryEngineFields.createdAt(entityAlias),
			queryEngineFields.updatedAt(entityAlias),
			queryEngineFields.properties(entityAlias),
			queryEngineFields.externalId(entityAlias),
			queryEngineFields.populatedAt(entityAlias),
			queryEngineFields.entitySchemaSlug(entityAlias),
			queryEngineFields.providerId(entityAlias),
			queryEngineField(
				"translationStatus",
				queryEngineComputedRef(entityAlias, "translationStatus"),
			),
		],
	});

export const buildEntityInterestQueryDocument = (input: {
	entityIds: QueryEngineNonEmptyArray<string>;
	entitySchemaSlugs: QueryEngineNonEmptyArray<string>;
}) => {
	const [firstEntityId, ...restEntityIds] = input.entityIds;
	const where =
		restEntityIds.length === 0
			? queryEngineEntityIdEquals(entityAlias, firstEntityId)
			: queryEngineOr(
					queryEngineEntityIdEquals(entityAlias, firstEntityId),
					...restEntityIds.map((entityId) => queryEngineEntityIdEquals(entityAlias, entityId)),
				);

	return buildQueryEngineEntityRowsDocument({
		where,
		alias: entityAlias,
		limit: input.entityIds.length,
		schemas: input.entitySchemaSlugs,
		orderBy: [queryEngineOrder("asc", queryEngineSystemRef(entityAlias, "id"))],
		fields: [
			...queryEngineIdentityFields(entityAlias),
			queryEngineFields.populatedAt(entityAlias),
			queryEngineFields.externalId(entityAlias),
			queryEngineFields.properties(entityAlias),
			queryEngineFields.entitySchemaSlug(entityAlias),
			queryEngineFields.providerId(entityAlias),
			queryEngineField(
				"translationStatus",
				queryEngineComputedRef(entityAlias, "translationStatus"),
			),
		],
	});
};

export const buildEventHistoryQueryDocument = (input: {
	page: number;
	limit?: number | undefined;
	entityId?: string | undefined;
	sessionEntityId?: string | undefined;
	eventSchemaSlugs: QueryEngineNonEmptyArray<string>;
	entitySchemaSlugs: QueryEngineNonEmptyArray<string>;
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
		eventAlias,
		entityAlias,
		page: input.page,
		limit: input.limit ?? 100,
		where: combineFilters(filters),
		eventSchemas: input.eventSchemaSlugs,
		entitySchemas: input.entitySchemaSlugs,
		orderBy: [
			queryEngineOrder("desc", queryEngineSystemRef(eventAlias, "occurredAt")),
			queryEngineOrder("desc", queryEngineSystemRef(eventAlias, "createdAt")),
			queryEngineOrder("desc", queryEngineSystemRef(eventAlias, "id")),
		],
		fields: [
			queryEngineFields.id(eventAlias),
			queryEngineFields.entityId(eventAlias),
			queryEngineFields.createdAt(eventAlias),
			queryEngineFields.updatedAt(eventAlias),
			queryEngineFields.occurredAt(eventAlias),
			queryEngineFields.properties(eventAlias),
			queryEngineFields.eventSchemaName(eventAlias),
			queryEngineFields.eventSchemaSlug(eventAlias),
			queryEngineFields.sessionEntityId(eventAlias),
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

export const buildAllCollectionsQueryDocument = (
	input: { page?: number | undefined; limit?: number | undefined } = {},
) =>
	buildDefaultSavedViewQueryDocument({
		page: input.page,
		limit: input.limit,
		orderBy: undefined,
		schemas: ["collection"],
	});
