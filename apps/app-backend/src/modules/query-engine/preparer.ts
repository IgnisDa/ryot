import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { match } from "ts-pattern";
import { db } from "~/lib/db";
import { entitySchema, eventSchema, relationshipSchema } from "~/lib/db/schema";
import {
	QueryEngineNotFoundError,
	QueryEngineValidationError,
} from "~/lib/views/errors";
import { nullViewExpression } from "~/lib/views/expression";
import type { QueryEngineEventJoinLike } from "~/lib/views/reference";
import {
	buildEventJoinMap,
	buildSchemaMap,
	type QueryEngineEventSchemaLike,
	type QueryEngineSchemaLike,
} from "~/lib/views/reference";
import {
	validateQueryEngineReferences,
	validateSavedViewDisplayConfiguration,
} from "~/lib/views/validator";
import { propertySchemaObjectSchema } from "~/modules/property-schemas";
import { getSavedViewBySlugForUser } from "../saved-views/repository";
import type {
	DisplayConfiguration,
	EventJoinDefinition,
	RelationshipFilter,
	SavedViewQueryDefinition,
} from "../saved-views/schemas";
import {
	executePreparedQuery,
	type QueryEngineSchemaRow,
} from "./query-builder";
import type {
	QueryEngineField,
	QueryEngineRequest,
	QueryEngineResponse,
} from "./schemas";

export type SavedViewLayout = keyof DisplayConfiguration;

export type SavedViewExecutionInput = {
	layout: SavedViewLayout;
	pagination: QueryEngineRequest["pagination"];
};

type PreparedQueryContext = {
	relationshipSchemaIds: string[];
	eventSchemaSlugs: ReadonlySet<string>;
	eventJoins: QueryEngineEventJoinLike[];
	runtimeSchemas: QueryEngineSchemaRow[];
	schemaMap: Map<string, QueryEngineSchemaRow>;
	eventJoinMap: Map<string, QueryEngineEventJoinLike>;
};

const parseAppSchema = (value: unknown) => {
	return propertySchemaObjectSchema.parse(value);
};

const normalizeQueryDefinition = (
	queryDefinition: SavedViewQueryDefinition,
): SavedViewQueryDefinition => ({
	...queryDefinition,
	filter: queryDefinition.filter ?? null,
	eventJoins: queryDefinition.eventJoins ?? [],
	relationships: queryDefinition.relationships ?? [],
	computedFields: queryDefinition.computedFields ?? [],
});

const buildPreparedFields = (input: {
	layout: SavedViewLayout;
	displayConfiguration: DisplayConfiguration;
}): QueryEngineField[] => {
	const buildCardPreparedFields = (
		configuration: DisplayConfiguration["grid"],
	) => {
		return [
			{
				key: "image",
				expression: configuration.imageProperty ?? nullViewExpression,
			},
			{
				key: "title",
				expression: configuration.titleProperty ?? nullViewExpression,
			},
			{
				key: "primarySubtitle",
				expression: configuration.primarySubtitleProperty ?? nullViewExpression,
			},
			{
				key: "secondarySubtitle",
				expression:
					configuration.secondarySubtitleProperty ?? nullViewExpression,
			},
			{
				key: "callout",
				expression: configuration.calloutProperty ?? nullViewExpression,
			},
		];
	};

	return match(input.layout)
		.with("grid", () =>
			buildCardPreparedFields(input.displayConfiguration.grid),
		)
		.with("list", () =>
			buildCardPreparedFields(input.displayConfiguration.list),
		)
		.with("table", () => {
			return input.displayConfiguration.table.columns.map((column, index) => ({
				key: `column_${index}`,
				expression: column.expression,
			}));
		})
		.exhaustive();
};

const buildPreparedRequest = (input: {
	fields: QueryEngineField[];
	queryDefinition: SavedViewQueryDefinition;
	pagination: QueryEngineRequest["pagination"];
}): QueryEngineRequest => {
	return {
		fields: input.fields,
		pagination: input.pagination,
		sort: input.queryDefinition.sort,
		filter: input.queryDefinition.filter,
		eventJoins: input.queryDefinition.eventJoins,
		relationships: input.queryDefinition.relationships,
		computedFields: input.queryDefinition.computedFields,
		entitySchemaSlugs: input.queryDefinition.entitySchemaSlugs,
	};
};

const validateSavedViewDefinition = (input: {
	eventSchemaSlugs: ReadonlySet<string>;
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
	schemaMap: Map<string, QueryEngineSchemaLike>;
	eventJoinMap: Map<string, QueryEngineEventJoinLike>;
}) => {
	const context = {
		schemaMap: input.schemaMap,
		eventJoinMap: input.eventJoinMap,
		eventSchemaSlugs: input.eventSchemaSlugs,
	};
	validateQueryEngineReferences(
		buildPreparedRequest({
			fields: [],
			pagination: { page: 1, limit: 1 },
			queryDefinition: input.queryDefinition,
		}),
		context,
	);
	validateSavedViewDisplayConfiguration(
		input.displayConfiguration,
		context,
		input.queryDefinition.computedFields,
	);
};

const loadVisibleSchemas = async (input: {
	userId: string;
	entitySchemaSlugs: string[];
}): Promise<QueryEngineSchemaRow[]> => {
	const uniqueSlugs = [...new Set(input.entitySchemaSlugs)];
	const rows = await db
		.select({
			id: entitySchema.id,
			slug: entitySchema.slug,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(entitySchema)
		.where(
			and(
				inArray(entitySchema.slug, uniqueSlugs),
				or(isNull(entitySchema.userId), eq(entitySchema.userId, input.userId)),
			),
		);

	const schemas = rows.map((row) => ({
		...row,
		propertiesSchema: parseAppSchema(row.propertiesSchema),
	}));
	const schemasBySlug = new Map<string, QueryEngineSchemaRow[]>();
	for (const schema of schemas) {
		const existing = schemasBySlug.get(schema.slug) ?? [];
		existing.push(schema);
		schemasBySlug.set(schema.slug, existing);
	}

	for (const slug of uniqueSlugs) {
		const found = schemasBySlug.get(slug);
		if (!found?.length) {
			throw new QueryEngineNotFoundError(`Schema '${slug}' not found`);
		}

		if (found.length > 1) {
			throw new QueryEngineValidationError(
				`Schema '${slug}' resolves to multiple visible schemas`,
			);
		}
	}

	return schemas;
};

const loadVisibleEventJoins = async (input: {
	userId: string;
	eventJoins: EventJoinDefinition[];
	runtimeSchemas: QueryEngineSchemaRow[];
}): Promise<QueryEngineEventJoinLike[]> => {
	if (!input.eventJoins.length) {
		return [];
	}

	const uniqueEventSchemaSlugs = [
		...new Set(input.eventJoins.map((join) => join.eventSchemaSlug)),
	];
	const rows = await db
		.select({
			id: eventSchema.id,
			slug: eventSchema.slug,
			entitySchemaSlug: entitySchema.slug,
			entitySchemaId: eventSchema.entitySchemaId,
			propertiesSchema: eventSchema.propertiesSchema,
		})
		.from(eventSchema)
		.innerJoin(entitySchema, eq(eventSchema.entitySchemaId, entitySchema.id))
		.where(
			and(
				inArray(
					eventSchema.entitySchemaId,
					input.runtimeSchemas.map((schema) => schema.id),
				),
				inArray(eventSchema.slug, uniqueEventSchemaSlugs),
				or(isNull(eventSchema.userId), eq(eventSchema.userId, input.userId)),
			),
		);

	const visibleEventSchemas = rows.map((row) => ({
		...row,
		propertiesSchema: parseAppSchema(row.propertiesSchema),
	}));
	const eventSchemasByEntitySchemaKey = new Map<
		string,
		QueryEngineEventSchemaLike
	>();
	for (const schema of visibleEventSchemas) {
		const key = `${schema.entitySchemaSlug}:${schema.slug}`;
		if (eventSchemasByEntitySchemaKey.has(key)) {
			throw new QueryEngineValidationError(
				`Event schema '${schema.slug}' resolves to multiple visible schemas for entity schema '${schema.entitySchemaSlug}'`,
			);
		}

		eventSchemasByEntitySchemaKey.set(key, schema);
	}

	return input.eventJoins.map((join) => {
		const eventSchemas = visibleEventSchemas.filter(
			(schema) => schema.slug === join.eventSchemaSlug,
		);
		if (!eventSchemas.length) {
			throw new QueryEngineValidationError(
				`Event schema '${join.eventSchemaSlug}' is not available for the requested entity schemas`,
			);
		}

		return {
			...join,
			eventSchemas,
			eventSchemaMap: new Map(
				eventSchemas.map((schema) => [schema.entitySchemaSlug, schema]),
			),
		};
	});
};

const loadRelationshipSchemaIds = async (
	relationships: RelationshipFilter[],
): Promise<string[]> => {
	if (!relationships.length) {
		return [];
	}

	const uniqueSlugs = [
		...new Set(relationships.map((r) => r.relationshipSchemaSlug)),
	];
	const rows = await db
		.select({ id: relationshipSchema.id, slug: relationshipSchema.slug })
		.from(relationshipSchema)
		.where(
			and(
				inArray(relationshipSchema.slug, uniqueSlugs),
				isNull(relationshipSchema.userId),
			),
		);

	const foundSlugs = new Set(rows.map((r) => r.slug));
	for (const slug of uniqueSlugs) {
		if (!foundSlugs.has(slug)) {
			throw new QueryEngineNotFoundError(
				`Relationship schema '${slug}' not found`,
			);
		}
	}

	return rows.map((r) => r.id);
};

const loadEventSchemaSlugs = async (input: {
	userId: string;
	runtimeSchemas: QueryEngineSchemaRow[];
}): Promise<ReadonlySet<string>> => {
	if (!input.runtimeSchemas.length) {
		return new Set();
	}

	const rows = await db
		.selectDistinct({ slug: eventSchema.slug })
		.from(eventSchema)
		.where(
			and(
				inArray(
					eventSchema.entitySchemaId,
					input.runtimeSchemas.map((s) => s.id),
				),
				or(isNull(eventSchema.userId), eq(eventSchema.userId, input.userId)),
			),
		);

	return new Set(rows.map((r) => r.slug));
};

const prepareContext = async (input: {
	userId: string;
	queryDefinition: SavedViewQueryDefinition;
}): Promise<PreparedQueryContext> => {
	const runtimeSchemas = await loadVisibleSchemas({
		userId: input.userId,
		entitySchemaSlugs: input.queryDefinition.entitySchemaSlugs,
	});
	const eventJoins = await loadVisibleEventJoins({
		runtimeSchemas,
		userId: input.userId,
		eventJoins: input.queryDefinition.eventJoins,
	});
	const relationshipSchemaIds = await loadRelationshipSchemaIds(
		input.queryDefinition.relationships,
	);
	const eventSchemaSlugs = await loadEventSchemaSlugs({
		runtimeSchemas,
		userId: input.userId,
	});
	const schemaMap = buildSchemaMap(runtimeSchemas);
	const eventJoinMap = buildEventJoinMap(eventJoins);

	return {
		schemaMap,
		eventJoins,
		eventJoinMap,
		runtimeSchemas,
		eventSchemaSlugs,
		relationshipSchemaIds,
	};
};

export const prepareAndExecute = async (input: {
	userId: string;
	request: QueryEngineRequest;
}): Promise<QueryEngineResponse> => {
	const queryDefinition = normalizeQueryDefinition({
		sort: input.request.sort,
		filter: input.request.filter,
		eventJoins: input.request.eventJoins,
		relationships: input.request.relationships,
		computedFields: input.request.computedFields,
		entitySchemaSlugs: input.request.entitySchemaSlugs,
	});
	const context = await prepareContext({
		userId: input.userId,
		queryDefinition,
	});

	const request = buildPreparedRequest({
		queryDefinition,
		fields: input.request.fields,
		pagination: input.request.pagination,
	});

	validateQueryEngineReferences(request, {
		schemaMap: context.schemaMap,
		eventJoinMap: context.eventJoinMap,
		eventSchemaSlugs: context.eventSchemaSlugs,
	});

	return executePreparedQuery({
		request,
		userId: input.userId,
		schemaMap: context.schemaMap,
		eventJoins: context.eventJoins,
		eventJoinMap: context.eventJoinMap,
		runtimeSchemas: context.runtimeSchemas,
		relationshipSchemaIds: context.relationshipSchemaIds,
	});
};

export const prepareForValidation = async (input: {
	userId: string;
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
}): Promise<void> => {
	const queryDefinition = normalizeQueryDefinition(input.queryDefinition);
	const context = await prepareContext({
		userId: input.userId,
		queryDefinition,
	});

	validateSavedViewDefinition({
		queryDefinition,
		schemaMap: context.schemaMap,
		eventJoinMap: context.eventJoinMap,
		eventSchemaSlugs: context.eventSchemaSlugs,
		displayConfiguration: input.displayConfiguration,
	});
};

export const prepareSavedView = async (input: {
	userId: string;
	viewSlug: string;
}): Promise<{
	execute(execution: SavedViewExecutionInput): Promise<QueryEngineResponse>;
}> => {
	const savedView = await getSavedViewBySlugForUser({
		userId: input.userId,
		viewSlug: input.viewSlug,
	});
	if (!savedView) {
		throw new QueryEngineNotFoundError("Saved view not found");
	}

	const queryDefinition = normalizeQueryDefinition(savedView.queryDefinition);
	const context = await prepareContext({
		userId: input.userId,
		queryDefinition,
	});

	validateSavedViewDefinition({
		queryDefinition,
		schemaMap: context.schemaMap,
		eventJoinMap: context.eventJoinMap,
		eventSchemaSlugs: context.eventSchemaSlugs,
		displayConfiguration: savedView.displayConfiguration,
	});

	return {
		execute: async (execution) => {
			const request = buildPreparedRequest({
				pagination: execution.pagination,
				queryDefinition,
				fields: buildPreparedFields({
					layout: execution.layout,
					displayConfiguration: savedView.displayConfiguration,
				}),
			});

			validateQueryEngineReferences(request, {
				schemaMap: context.schemaMap,
				eventJoinMap: context.eventJoinMap,
				eventSchemaSlugs: context.eventSchemaSlugs,
			});

			return executePreparedQuery({
				request,
				userId: input.userId,
				schemaMap: context.schemaMap,
				eventJoins: context.eventJoins,
				eventJoinMap: context.eventJoinMap,
				runtimeSchemas: context.runtimeSchemas,
				relationshipSchemaIds: context.relationshipSchemaIds,
			});
		},
	};
};
