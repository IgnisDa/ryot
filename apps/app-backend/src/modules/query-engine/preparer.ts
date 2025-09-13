import { match } from "ts-pattern";

import { QueryEngineNotFoundError, QueryEngineValidationError } from "~/lib/views/errors";
import { nullViewExpression } from "~/lib/views/expression";
import {
	type QueryEngineEventJoinLike,
	type QueryEngineEventSchemaLike,
	buildEventJoinMap,
	buildRelationshipJoinMap,
	buildSchemaMap,
	type QueryEngineRelationshipJoinLike,
	type QueryEngineSchemaLike,
} from "~/lib/views/reference";
import {
	validateQueryEngineReferences,
	validateSavedViewDisplayConfiguration,
} from "~/lib/views/validator";
import type {
	DisplayConfiguration,
	EventJoinDefinition,
	LatestRelationshipJoinDefinition,
	SavedViewQueryDefinition,
} from "~/modules/saved-views";
import { getSavedViewBySlugForUser } from "~/modules/saved-views";

import { executeAggregateQuery } from "./aggregate-query-builder";
import type { PreparedQueryContext } from "./context";
import { executePreparedQuery } from "./entity-query-builder";
import { executeEventQuery } from "./event-query-builder";
import {
	loadEventSchemaSlugs,
	loadEventSchemasBySlug,
	loadVisibleRelationshipJoins,
	loadVisibleEventJoins,
	loadVisibleSchemas,
} from "./loaders";
import type {
	EntityQueryEngineRequest,
	QueryEngineField,
	QueryEngineRequest,
	QueryEngineResponse,
} from "./schemas";
import { executeTimeSeriesQuery } from "./time-series-query-builder";

export type { PreparedQueryContext } from "./context";

export type SavedViewLayout = keyof Pick<DisplayConfiguration, "grid" | "list" | "table">;

export type SavedViewExecutionInput = {
	layout: SavedViewLayout;
	pagination: EntityQueryEngineRequest["pagination"];
};

type PrepareContextInput = {
	scope: string[];
	eventSchemas: string[];
	mode: QueryEngineRequest["mode"];
	eventJoins: EventJoinDefinition[];
	relationshipJoins: LatestRelationshipJoinDefinition[];
};

export const normalizeRequestPerMode = (request: QueryEngineRequest): PrepareContextInput => {
	return match(request)
		.with({ mode: "entities" }, { mode: "aggregate" }, (r) => ({
			mode: r.mode,
			scope: r.scope,
			eventJoins: r.eventJoins,
			eventSchemas: [] as string[],
			relationshipJoins: r.relationshipJoins,
		}))
		.with({ mode: "events" }, (r) => ({
			mode: r.mode,
			scope: r.scope,
			eventJoins: r.eventJoins,
			eventSchemas: r.eventSchemas,
			relationshipJoins: [] as LatestRelationshipJoinDefinition[],
		}))
		.with({ mode: "timeSeries" }, (r) => ({
			mode: r.mode,
			scope: r.scope,
			eventSchemas: r.eventSchemas,
			eventJoins: [] as EventJoinDefinition[],
			relationshipJoins: [] as LatestRelationshipJoinDefinition[],
		}))
		.exhaustive();
};

const buildCardPreparedFields = (cardInput: {
	configuration: DisplayConfiguration["grid"];
	entityIdProperty: DisplayConfiguration["entityIdProperty"];
}) => {
	return [
		{ key: "entityId", expression: cardInput.entityIdProperty },
		{ key: "eyebrow", expression: cardInput.configuration.eyebrowProperty ?? nullViewExpression },
		{ key: "image", expression: cardInput.configuration.imageProperty ?? nullViewExpression },
		{ key: "title", expression: cardInput.configuration.titleProperty },
		{
			key: "primarySubtitle",
			expression: cardInput.configuration.primarySubtitleProperty ?? nullViewExpression,
		},
		{
			key: "secondarySubtitle",
			expression: cardInput.configuration.secondarySubtitleProperty ?? nullViewExpression,
		},
		{ key: "callout", expression: cardInput.configuration.calloutProperty ?? nullViewExpression },
	];
};

const buildPreparedFields = (input: {
	layout: SavedViewLayout;
	displayConfiguration: DisplayConfiguration;
}): QueryEngineField[] => {
	return match(input.layout)
		.with("grid", () =>
			buildCardPreparedFields({
				configuration: input.displayConfiguration.grid,
				entityIdProperty: input.displayConfiguration.entityIdProperty,
			}),
		)
		.with("list", () =>
			buildCardPreparedFields({
				configuration: input.displayConfiguration.list,
				entityIdProperty: input.displayConfiguration.entityIdProperty,
			}),
		)
		.with("table", () => {
			return [
				{ key: "entityId", expression: input.displayConfiguration.entityIdProperty },
				...input.displayConfiguration.table.columns.map((column, index) => ({
					key: `column_${index}`,
					expression: column.expression,
				})),
			];
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
		computedFields: input.queryDefinition.computedFields,
		relationshipJoins: input.queryDefinition.relationshipJoins,
	};
};

const validateSavedViewDefinition = (input: {
	eventSchemaSlugs: ReadonlySet<string>;
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
	schemaMap: Map<string, QueryEngineSchemaLike>;
	eventJoinMap: Map<string, QueryEngineEventJoinLike>;
	eventSchemaMap?: Map<string, QueryEngineEventSchemaLike[]>;
	relationshipJoinMap: Map<string, QueryEngineRelationshipJoinLike>;
}) => {
	const context = {
		schemaMap: input.schemaMap,
		eventJoinMap: input.eventJoinMap,
		eventSchemaMap: input.eventSchemaMap,
		eventSchemaSlugs: input.eventSchemaSlugs,
		relationshipJoinMap: input.relationshipJoinMap,
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

	if (isEventMode && query.eventSchemas.length === 0) {
		throw new QueryEngineValidationError("At least one event schema slug is required");
	}

	const [eventJoins, relationshipJoins, eventSchemaSlugs] = await Promise.all([
		loadVisibleEventJoins({
			runtimeSchemas,
			userId: input.userId,
			eventJoins: eventJoinsForMode,
		}),
		isEventMode
			? (Promise.resolve([]) as Promise<PreparedQueryContext["relationshipJoins"]>)
			: loadVisibleRelationshipJoins({
					runtimeSchemas,
					userId: input.userId,
					relationshipJoins: query.relationshipJoins,
				}),
		loadEventSchemaSlugs({ runtimeSchemas, userId: input.userId }),
	]);

	const eventSchemaMap = isEventMode
		? await loadEventSchemaMap({
				runtimeSchemas,
				userId: input.userId,
				eventSchemaSlugs:
					query.eventSchemas.length > 0 ? query.eventSchemas : [...eventSchemaSlugs],
			})
		: undefined;

	const schemaMap = buildSchemaMap(runtimeSchemas);
	const eventJoinMap = buildEventJoinMap(eventJoins);
	const relationshipJoinMap = buildRelationshipJoinMap(relationshipJoins);

	return {
		schemaMap,
		eventJoins,
		eventJoinMap,
		runtimeSchemas,
		eventSchemaMap,
		eventSchemaSlugs,
		relationshipJoins,
		relationshipJoinMap,
	};
};

const loadEventSchemaMap = (input: {
	userId: string;
	eventSchemaSlugs: string[];
	runtimeSchemas: PreparedQueryContext["runtimeSchemas"];
}) => {
	return loadEventSchemasBySlug(input);
};

const loadOptionalEventSchemaMap = (input: {
	userId: string;
	shouldLoad: boolean;
	eventSchemaSlugs: Iterable<string>;
	runtimeSchemas: PreparedQueryContext["runtimeSchemas"];
}) => {
	return input.shouldLoad
		? loadEventSchemaMap({
				runtimeSchemas: input.runtimeSchemas,
				userId: input.userId,
				eventSchemaSlugs: [...input.eventSchemaSlugs],
			})
		: Promise.resolve(new Map());
};

export const prepareAndExecute = async (input: {
	userId: string;
	request: QueryEngineRequest;
}): Promise<QueryEngineResponse> => {
	const query = normalizeRequestPerMode(input.request);

	const context = await prepareContext({ userId: input.userId, query });

	const eventSchemaMap =
		context.eventSchemaMap ??
		(await loadOptionalEventSchemaMap({
			userId: input.userId,
			shouldLoad: hasEventAggregateRef(input.request),
			runtimeSchemas: context.runtimeSchemas,
			eventSchemaSlugs: context.eventSchemaSlugs,
		}));

	validateQueryEngineReferences(input.request, {
		eventSchemaMap,
		schemaMap: context.schemaMap,
		eventJoinMap: context.eventJoinMap,
		eventSchemaSlugs: context.eventSchemaSlugs,
		relationshipJoinMap: context.relationshipJoinMap,
		supportsPrimaryEventRefs:
			input.request.mode === "events" || input.request.mode === "timeSeries",
	});

	return match(input.request)
		.with({ mode: "entities" }, (request) =>
			executePreparedQuery({
				request,
				userId: input.userId,
				context: { ...context, eventSchemaMap },
			}),
		)
		.with({ mode: "aggregate" }, (request) =>
			executeAggregateQuery({
				request,
				userId: input.userId,
				context: { ...context, eventSchemaMap },
			}),
		)
		.with({ mode: "events" }, (request) =>
			executeEventQuery({ request, userId: input.userId, context: { ...context, eventSchemaMap } }),
		)
		.with({ mode: "timeSeries" }, (request) =>
			executeTimeSeriesQuery({
				request,
				userId: input.userId,
				context: { ...context, eventSchemaMap },
			}),
		)
		.exhaustive();
};

const hasEventAggregateRef = (obj: unknown): boolean => {
	if (obj === null || typeof obj !== "object") {
		return false;
	}
	if (Array.isArray(obj)) {
		return obj.some(hasEventAggregateRef);
	}
	if ("type" in obj && obj.type === "event-aggregate") {
		return true;
	}
	return Object.values(obj).some(hasEventAggregateRef);
};

export const loadAndValidateQueryContext = async (input: {
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
			relationshipJoins: input.queryDefinition.relationshipJoins,
		},
	});

	const eventSchemaMap = await loadOptionalEventSchemaMap({
		userId: input.userId,
		runtimeSchemas: context.runtimeSchemas,
		eventSchemaSlugs: context.eventSchemaSlugs,
		shouldLoad:
			hasEventAggregateRef(input.queryDefinition) ||
			hasEventAggregateRef(input.displayConfiguration),
	});

	validateSavedViewDefinition({
		eventSchemaMap,
		schemaMap: context.schemaMap,
		eventJoinMap: context.eventJoinMap,
		queryDefinition: input.queryDefinition,
		eventSchemaSlugs: context.eventSchemaSlugs,
		relationshipJoinMap: context.relationshipJoinMap,
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
			relationshipJoins: queryDefinition.relationshipJoins,
		},
	});

	const eventSchemaMap = await loadOptionalEventSchemaMap({
		userId: input.userId,
		runtimeSchemas: context.runtimeSchemas,
		eventSchemaSlugs: context.eventSchemaSlugs,
		shouldLoad:
			hasEventAggregateRef(queryDefinition) || hasEventAggregateRef(savedView.displayConfiguration),
	});

	validateSavedViewDefinition({
		eventSchemaMap,
		queryDefinition,
		schemaMap: context.schemaMap,
		eventJoinMap: context.eventJoinMap,
		eventSchemaSlugs: context.eventSchemaSlugs,
		relationshipJoinMap: context.relationshipJoinMap,
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
				context: { ...context, eventSchemaMap },
			});
		},
	};
};
