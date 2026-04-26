import { match } from "ts-pattern";
import { QueryEngineNotFoundError } from "~/lib/views/errors";
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
import { getSavedViewBySlugForUser } from "../saved-views/repository";
import type {
	DisplayConfiguration,
	EventJoinDefinition,
	RelationshipFilter,
	SavedViewQueryDefinition,
} from "../saved-views/schemas";
import { executeAggregateQuery } from "./aggregate-query-builder";
import { executePreparedQuery } from "./entity-query-builder";
import { executeEventQuery } from "./event-query-builder";
import {
	loadEventSchemaSlugs,
	loadEventSchemasBySlug,
	loadRelationshipSchemaIds,
	loadVisibleEventJoins,
	loadVisibleSchemas,
} from "./loaders";
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

type PrepareContextInput = {
	scope: string[];
	eventSchemas: string[];
	mode: QueryEngineRequest["mode"];
	eventJoins: EventJoinDefinition[];
	relationships: RelationshipFilter[];
};

export type PreparedQueryContext = {
	relationshipSchemaIds: string[];
	eventSchemaSlugs: ReadonlySet<string>;
	eventJoins: QueryEngineEventJoinLike[];
	runtimeSchemas: QueryEngineSchemaRow[];
	schemaMap: Map<string, QueryEngineSchemaRow>;
	eventJoinMap: Map<string, QueryEngineEventJoinLike>;
	eventSchemaMap?: Map<string, QueryEngineEventSchemaLike[]>;
};

export const normalizeRequestPerMode = (
	request: QueryEngineRequest,
): PrepareContextInput => {
	return match(request)
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

const prepareContext = async (input: {
	userId: string;
	query: PrepareContextInput;
}): Promise<PreparedQueryContext> => {
	const { query } = input;
	const runtimeSchemas = await loadVisibleSchemas({
		scope: query.scope,
		userId: input.userId,
	});

	const isEventMode = query.mode === "events" || query.mode === "timeSeries";
	const eventJoinsForMode = query.mode === "timeSeries" ? [] : query.eventJoins;

	const [eventJoins, relationshipSchemaIds, eventSchemaSlugs] =
		await Promise.all([
			loadVisibleEventJoins({
				runtimeSchemas,
				userId: input.userId,
				eventJoins: eventJoinsForMode,
			}),
			isEventMode
				? (Promise.resolve([]) as Promise<string[]>)
				: loadRelationshipSchemaIds(query.relationships),
			loadEventSchemaSlugs({ runtimeSchemas, userId: input.userId }),
		]);

	const eventSchemaMap = await loadEventSchemasBySlug({
		runtimeSchemas,
		userId: input.userId,
		eventSchemaSlugs: isEventMode ? query.eventSchemas : [...eventSchemaSlugs],
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
	const query = normalizeRequestPerMode(input.request);

	const context = await prepareContext({ userId: input.userId, query });
	validateQueryEngineReferences(input.request, {
		schemaMap: context.schemaMap,
		eventJoinMap: context.eventJoinMap,
		eventSchemaMap: context.eventSchemaMap,
		eventSchemaSlugs: context.eventSchemaSlugs,
		supportsPrimaryEventRefs:
			input.request.mode === "events" || input.request.mode === "timeSeries",
	});

	return match(input.request)
		.with({ mode: "entities" }, (request) =>
			executePreparedQuery({ request, userId: input.userId, context }),
		)
		.with({ mode: "aggregate" }, (request) =>
			executeAggregateQuery({ request, userId: input.userId, context }),
		)
		.with({ mode: "events" }, (request) =>
			executeEventQuery({ request, userId: input.userId, context }),
		)
		.with({ mode: "timeSeries" }, (request) =>
			executeTimeSeriesQuery({ request, userId: input.userId, context }),
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
		schemaMap: context.schemaMap,
		eventJoinMap: context.eventJoinMap,
		eventSchemaMap: context.eventSchemaMap,
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

			return executePreparedQuery({
				request,
				userId: input.userId,
				context,
			});
		},
	};
};
