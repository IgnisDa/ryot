import {
	buildQueryEngineEntityRowsDocument,
	queryEngineEntityIdEquals,
	queryEngineFields,
} from "../documents";
import {
	queryEngineOr,
	queryEngineOrder,
	queryEngineSystemRef,
	type QueryEngineNonEmptyArray,
} from "../primitives";
import { buildEventHistoryQueryDocument } from "./app";

const entityAlias = "entity";

const entityReadFields = [
	queryEngineFields.id(entityAlias),
	queryEngineFields.name(entityAlias),
	queryEngineFields.createdAt(entityAlias),
	queryEngineFields.updatedAt(entityAlias),
	queryEngineFields.properties(entityAlias),
	queryEngineFields.entitySchemaSlug(entityAlias),
	queryEngineFields.providerId(entityAlias),
	queryEngineFields.externalId(entityAlias),
	queryEngineFields.populatedAt(entityAlias),
];

export const buildEntityReadQuery = (input: {
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
		alias: entityAlias,
		schemas: input.entitySchemaSlugs,
		where,
		fields: entityReadFields,
		orderBy: [queryEngineOrder("asc", queryEngineSystemRef(entityAlias, "id"))],
		page: 1,
		limit: 100,
	});
};

export const buildEventReadQuery = (input: {
	entityId?: string;
	eventSchemaSlug: string;
	entitySchemaSlug: string;
	page?: number;
	sessionEntityId?: string;
}) =>
	buildEventHistoryQueryDocument({
		page: input.page ?? 1,
		eventSchemaSlugs: [input.eventSchemaSlug],
		entitySchemaSlugs: [input.entitySchemaSlug],
		entityId: input.entityId,
		sessionEntityId: input.sessionEntityId,
	});
