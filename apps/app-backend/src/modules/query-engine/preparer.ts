import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { match } from "ts-pattern";
import { db } from "~/lib/db";
import { entitySchema, eventSchema, relationshipSchema } from "~/lib/db/schema";
import {
	QueryEngineNotFoundError,
	QueryEngineValidationError,
} from "~/lib/views/errors";
import { nullViewExpression } from "~/lib/views/expression";
import type {
	QueryEngineEventJoinLike,
	QueryEngineEventSchemaLike,
} from "~/lib/views/reference";
import {
	buildEventJoinMap,
	buildSchemaMap,
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
import { executeAggregateQuery } from "./aggregate-query-builder";
import { executeEventQuery } from "./event-query-builder";
import { executePreparedQuery } from "./query-builder";
import type { QueryEngineSchemaRow } from "./query-ctes";
import type {
	EntityQueryEngineRequest,
	QueryEngineField,
	QueryEngineRequest,
	QueryEngineResponse,
} from "./schemas";
import { executeTimeSeriesQuery } from "./time-series-query-builder";

export type SavedViewLayout = keyof DisplayConfiguration;

export type SavedViewExecutionInput = {
	layout: SavedViewLayout;
	pagination: EntityQueryEngineRequest["pagination"];
};

// Internal type used by prepareContext — covers all four modes so that
// prepareAndExecute can drive it without going through SavedViewQueryDefinition
// (which is entity-only for the public saved-view API).
type PrepareContextInput = {
	scope: string[];
	eventSchemas: string[];
	mode: QueryEngineRequest["mode"];
	eventJoins: EventJoinDefinition[];
	relationships: RelationshipFilter[];
};

type PreparedQueryContext = {
	relationshipSchemaIds: string[];
	eventSchemaSlugs: ReadonlySet<string>;
	eventJoins: QueryEngineEventJoinLike[];
	runtimeSchemas: QueryEngineSchemaRow[];
	schemaMap: Map<string, QueryEngineSchemaRow>;
	eventJoinMap: Map<string, QueryEngineEventJoinLike>;
	eventSchemaMap?: Map<string, QueryEngineEventSchemaLike[]>;
};

const parseAppSchema = (value: unknown) => {
	return propertySchemaObjectSchema.parse(value);
};

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

const buildPreparedEntityRequest = (input: {
	fields: QueryEngineField[];
	queryDefinition: SavedViewQueryDefinition;
	pagination: EntityQueryEngineRequest["pagination"];
}): EntityQueryEngineRequest => {
	return {
		mode: "entities",
		fields: input.fields,
		pagination: input.pagination,
		sort: input.queryDefinition.sort,
		scope: input.queryDefinition.scope,
		filter: input.queryDefinition.filter,
		eventJoins: input.queryDefinition.eventJoins,
		relationships: input.queryDefinition.relationships,
		computedFields: input.queryDefinition.computedFields,
	};
};

const validateSavedViewDefinition = (input: {
	eventSchemaSlugs: ReadonlySet<string>;
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
	schemaMap: Map<string, QueryEngineSchemaLike>;
	eventJoinMap: Map<string, QueryEngineEventJoinLike>;
	eventSchemaMap?: Map<string, QueryEngineEventSchemaLike[]>;
}) => {
	const context = {
		schemaMap: input.schemaMap,
		eventJoinMap: input.eventJoinMap,
		eventSchemaMap: input.eventSchemaMap,
		eventSchemaSlugs: input.eventSchemaSlugs,
	};
	validateQueryEngineReferences(
		buildPreparedEntityRequest({
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
	scope: string[];
}): Promise<QueryEngineSchemaRow[]> => {
	const uniqueSlugs = [...new Set(input.scope)];
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

const loadEventSchemasBySlug = async (input: {
	userId: string;
	eventSchemaSlugs: string[];
	runtimeSchemas: QueryEngineSchemaRow[];
}): Promise<Map<string, QueryEngineEventSchemaLike[]>> => {
	if (!input.eventSchemaSlugs.length || !input.runtimeSchemas.length) {
		return new Map();
	}

	const uniqueSlugs = [...new Set(input.eventSchemaSlugs)];
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
					input.runtimeSchemas.map((s) => s.id),
				),
				inArray(eventSchema.slug, uniqueSlugs),
				or(isNull(eventSchema.userId), eq(eventSchema.userId, input.userId)),
			),
		);

	for (const slug of uniqueSlugs) {
		if (!rows.some((r) => r.slug === slug)) {
			throw new QueryEngineNotFoundError(
				`Event schema '${slug}' not found for the requested entity schemas`,
			);
		}
	}

	const eventSchemaMap = new Map<string, QueryEngineEventSchemaLike[]>();
	for (const row of rows) {
		const parsedRow = {
			...row,
			propertiesSchema: parseAppSchema(row.propertiesSchema),
		};
		const existing = eventSchemaMap.get(row.slug) ?? [];
		existing.push(parsedRow);
		eventSchemaMap.set(row.slug, existing);
	}

	return eventSchemaMap;
};

const prepareContext = async (input: {
	userId: string;
	query: PrepareContextInput;
}): Promise<PreparedQueryContext> => {
	const { query } = input;
	const runtimeSchemas = await loadVisibleSchemas({
		scope: query.scope,
		userId: input.userId,
	});

	const eventJoinsForMode = query.mode === "timeSeries" ? [] : query.eventJoins;
	const eventJoins = await loadVisibleEventJoins({
		runtimeSchemas,
		userId: input.userId,
		eventJoins: eventJoinsForMode,
	});

	const relationshipSchemaIds =
		query.mode !== "events" && query.mode !== "timeSeries"
			? await loadRelationshipSchemaIds(query.relationships)
			: [];
	const eventSchemaSlugs = await loadEventSchemaSlugs({
		runtimeSchemas,
		userId: input.userId,
	});
	const eventSchemaMap = await loadEventSchemasBySlug({
		runtimeSchemas,
		userId: input.userId,
		eventSchemaSlugs:
			query.mode === "events" || query.mode === "timeSeries"
				? query.eventSchemas
				: [...eventSchemaSlugs],
	});
	const schemaMap = buildSchemaMap(runtimeSchemas);
	const eventJoinMap = buildEventJoinMap(eventJoins);

	return {
		schemaMap,
		eventJoins,
		eventJoinMap,
		runtimeSchemas,
		eventSchemaMap,
		eventSchemaSlugs,
		relationshipSchemaIds,
	};
};

export const prepareAndExecute = async (input: {
	userId: string;
	request: QueryEngineRequest;
}): Promise<QueryEngineResponse> => {
	const query: PrepareContextInput = match(input.request)
		.with({ mode: "entities" }, (r) => ({
			mode: r.mode,
			scope: r.scope,
			eventJoins: r.eventJoins,
			eventSchemas: [] as string[],
			relationships: r.relationships,
		}))
		.with({ mode: "aggregate" }, (r) => ({
			mode: r.mode,
			scope: r.scope,
			eventJoins: r.eventJoins,
			eventSchemas: [] as string[],
			relationships: r.relationships,
		}))
		.with({ mode: "events" }, (r) => ({
			mode: r.mode,
			scope: r.scope,
			eventJoins: r.eventJoins,
			eventSchemas: r.eventSchemas,
			relationships: [] as RelationshipFilter[],
		}))
		.with({ mode: "timeSeries" }, (r) => ({
			mode: r.mode,
			scope: r.scope,
			eventSchemas: r.eventSchemas,
			eventJoins: [] as EventJoinDefinition[],
			relationships: [] as RelationshipFilter[],
		}))
		.exhaustive();

	const context = await prepareContext({ userId: input.userId, query });
	validateQueryEngineReferences(input.request, {
		supportsPrimaryEventRefs:
			input.request.mode === "events" || input.request.mode === "timeSeries",
		schemaMap: context.schemaMap,
		eventJoinMap: context.eventJoinMap,
		eventSchemaMap: context.eventSchemaMap,
		eventSchemaSlugs: context.eventSchemaSlugs,
	});

	return match(input.request)
		.with({ mode: "entities" }, (request) =>
			executePreparedQuery({
				request,
				userId: input.userId,
				schemaMap: context.schemaMap,
				eventJoins: context.eventJoins,
				eventJoinMap: context.eventJoinMap,
				runtimeSchemas: context.runtimeSchemas,
				relationshipSchemaIds: context.relationshipSchemaIds,
			}),
		)
		.with({ mode: "aggregate" }, (request) =>
			executeAggregateQuery({
				request,
				userId: input.userId,
				schemaMap: context.schemaMap,
				eventJoins: context.eventJoins,
				eventJoinMap: context.eventJoinMap,
				runtimeSchemas: context.runtimeSchemas,
				relationshipSchemaIds: context.relationshipSchemaIds,
			}),
		)
		.with({ mode: "events" }, (request) =>
			executeEventQuery({
				request,
				userId: input.userId,
				schemaMap: context.schemaMap,
				eventJoins: context.eventJoins,
				eventJoinMap: context.eventJoinMap,
				runtimeSchemas: context.runtimeSchemas,
				eventSchemaMap: context.eventSchemaMap ?? new Map(),
			}),
		)
		.with({ mode: "timeSeries" }, (request) =>
			executeTimeSeriesQuery({
				request,
				userId: input.userId,
				schemaMap: context.schemaMap,
				runtimeSchemas: context.runtimeSchemas,
				eventSchemaMap: context.eventSchemaMap ?? new Map(),
			}),
		)
		.exhaustive();
};

export const prepareForValidation = async (input: {
	userId: string;
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
}): Promise<void> => {
	const context = await prepareContext({
		userId: input.userId,
		query: {
			mode: "entities",
			eventSchemas: [],
			scope: input.queryDefinition.scope,
			eventJoins: input.queryDefinition.eventJoins,
			relationships: input.queryDefinition.relationships,
		},
	});
	validateSavedViewDefinition({
		eventSchemaMap: context.eventSchemaMap,
		schemaMap: context.schemaMap,
		eventJoinMap: context.eventJoinMap,
		queryDefinition: input.queryDefinition,
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

	const queryDefinition = savedView.queryDefinition;
	const context = await prepareContext({
		userId: input.userId,
		query: {
			mode: "entities",
			eventSchemas: [],
			scope: queryDefinition.scope,
			eventJoins: queryDefinition.eventJoins,
			relationships: queryDefinition.relationships,
		},
	});

	validateSavedViewDefinition({
		queryDefinition,
		schemaMap: context.schemaMap,
		eventJoinMap: context.eventJoinMap,
		eventSchemaMap: context.eventSchemaMap,
		eventSchemaSlugs: context.eventSchemaSlugs,
		displayConfiguration: savedView.displayConfiguration,
	});

	return {
		execute: async (execution) => {
			const request = buildPreparedEntityRequest({
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
