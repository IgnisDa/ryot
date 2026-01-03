import { Effect, Match } from "effect";

import type { CurrentDb } from "#lib/db";
import type { DbError } from "#lib/errors";
import { BadRequest, NotFound } from "#lib/errors";
import type {
	DisplayConfiguration,
	QueryEngineRequest,
	QueryEventJoin,
	QueryRelationshipJoin,
	SavedViewQueryDefinition,
} from "#lib/query-language";
import { QueryEngineNotFoundError } from "#lib/views/errors";
import {
	buildEventJoinMap,
	buildRelationshipJoinMap,
	buildSchemaMap,
	type QueryEngineEventSchemaLike,
	type QueryEngineReferenceContext,
} from "#lib/views/reference";
import {
	validateQueryEngineReferences,
	validateSavedViewDisplayConfiguration,
} from "#lib/views/validator";

import { executeAggregateQuery } from "./aggregate-query-builder";
import type { PreparedQueryContext } from "./context";
import { executePreparedQuery } from "./entity-query-builder";
import { executeEventQuery } from "./event-query-builder";
import {
	loadEventSchemaSlugs,
	loadEventSchemasBySlug,
	loadVisibleEventJoins,
	loadVisibleRelationshipJoins,
	loadVisibleSchemas,
} from "./loaders";
import { executeTimeSeriesQuery } from "./time-series-query-builder";

const tryQueryEngineSync = <T>(fn: () => T): Effect.Effect<T, NotFound | BadRequest> =>
	Effect.try({
		try: fn,
		catch: (error) => {
			if (error instanceof QueryEngineNotFoundError) {
				return new NotFound({ message: error.message });
			}
			return new BadRequest({
				message: error instanceof Error ? error.message : String(error),
			});
		},
	});

type PrepareContextInput = {
	scope: string[];
	eventSchemas: string[];
	mode: QueryEngineRequest["mode"];
	eventJoins: QueryEventJoin[];
	relationshipJoins: QueryRelationshipJoin[];
};

export const normalizeRequestPerMode = (request: QueryEngineRequest): PrepareContextInput => {
	return Match.value(request).pipe(
		Match.whenOr({ mode: "entities" }, { mode: "aggregate" }, (r) => ({
			mode: r.mode,
			scope: [...r.scope],
			eventJoins: r.eventJoins ? [...r.eventJoins] : [],
			eventSchemas: [] as string[],
			relationshipJoins: r.relationshipJoins ? [...r.relationshipJoins] : [],
		})),
		Match.when({ mode: "events" }, (r) => ({
			mode: r.mode,
			scope: [...r.scope],
			eventJoins: r.eventJoins ? [...r.eventJoins] : [],
			eventSchemas: [...r.eventSchemas],
			relationshipJoins: [],
		})),
		Match.when({ mode: "timeSeries" }, (r) => ({
			mode: r.mode,
			scope: [...r.scope],
			eventSchemas: [...r.eventSchemas],
			eventJoins: [],
			relationshipJoins: [],
		})),
		Match.exhaustive,
	);
};

const hasEventAggregateRef = (obj: unknown): boolean => {
	if (obj === null || typeof obj !== "object") {
		return false;
	}
	if (Array.isArray(obj)) {
		return obj.some(hasEventAggregateRef);
	}
	if (Reflect.get(obj, "type") === "event-aggregate") {
		return true;
	}
	return Object.values(obj).some(hasEventAggregateRef);
};

const prepareContext = (input: {
	userId: string;
	query: PrepareContextInput;
}): Effect.Effect<PreparedQueryContext, NotFound | BadRequest | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const { query } = input;
		const runtimeSchemas = yield* loadVisibleSchemas({
			scope: query.scope,
			userId: input.userId,
		});

		const isEventMode = query.mode === "events" || query.mode === "timeSeries";
		const eventJoinsForMode = query.mode === "timeSeries" ? [] : query.eventJoins;

		if (isEventMode && query.eventSchemas.length === 0) {
			return yield* new BadRequest({
				message: "At least one event schema slug is required",
			});
		}

		const [eventJoins, relationshipJoins, eventSchemaSlugs] = yield* Effect.all([
			loadVisibleEventJoins({
				runtimeSchemas,
				userId: input.userId,
				eventJoins: eventJoinsForMode,
			}),
			isEventMode
				? Effect.succeed([] as PreparedQueryContext["relationshipJoins"])
				: loadVisibleRelationshipJoins({
						runtimeSchemas,
						userId: input.userId,
						relationshipJoins: query.relationshipJoins,
					}),
			loadEventSchemaSlugs({ runtimeSchemas, userId: input.userId }),
		]);

		const eventSchemaMap = isEventMode
			? yield* loadEventSchemasBySlug({
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
	});

const loadOptionalEventSchemaMap = (input: {
	userId: string;
	shouldLoad: boolean;
	eventSchemaSlugs: Iterable<string>;
	runtimeSchemas: PreparedQueryContext["runtimeSchemas"];
}): Effect.Effect<
	Map<string, QueryEngineEventSchemaLike[]>,
	NotFound | BadRequest | DbError,
	CurrentDb
> => {
	if (!input.shouldLoad) {
		return Effect.succeed(new Map());
	}
	return loadEventSchemasBySlug({
		runtimeSchemas: input.runtimeSchemas,
		userId: input.userId,
		eventSchemaSlugs: [...input.eventSchemaSlugs],
	});
};

const buildSavedViewValidationRequest = (
	queryDefinition: SavedViewQueryDefinition,
): Extract<QueryEngineRequest, { mode: "entities" }> => ({
	fields: [],
	mode: "entities",
	sort: queryDefinition.sort,
	filter: queryDefinition.filter,
	scope: [...queryDefinition.scope],
	pagination: { page: 1, limit: 1 },
	eventJoins: [...queryDefinition.eventJoins],
	computedFields: [...queryDefinition.computedFields],
	relationshipJoins: [...(queryDefinition.relationshipJoins ?? [])],
});

const validateSavedViewDefinition = (input: {
	context: QueryEngineReferenceContext;
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
}) => {
	validateQueryEngineReferences(
		buildSavedViewValidationRequest(input.queryDefinition),
		input.context,
	);
	validateSavedViewDisplayConfiguration(
		input.displayConfiguration,
		input.context,
		input.queryDefinition.computedFields,
	);
};

export const loadAndValidateQueryContext = (input: {
	userId: string;
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
}): Effect.Effect<void, BadRequest | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const context = yield* prepareContext({
			userId: input.userId,
			query: {
				mode: "entities",
				eventSchemas: [],
				scope: [...input.queryDefinition.scope],
				eventJoins: [...input.queryDefinition.eventJoins],
				relationshipJoins: [...(input.queryDefinition.relationshipJoins ?? [])],
			},
		});

		const eventSchemaMap = yield* loadOptionalEventSchemaMap({
			userId: input.userId,
			runtimeSchemas: context.runtimeSchemas,
			eventSchemaSlugs: context.eventSchemaSlugs,
			shouldLoad:
				hasEventAggregateRef(input.queryDefinition) ||
				hasEventAggregateRef(input.displayConfiguration),
		});

		const validationContext = {
			eventSchemaMap,
			schemaMap: context.schemaMap,
			eventJoinMap: context.eventJoinMap,
			eventSchemaSlugs: context.eventSchemaSlugs,
			relationshipJoinMap: context.relationshipJoinMap,
		} satisfies QueryEngineReferenceContext;

		yield* Effect.try({
			try: () =>
				validateSavedViewDefinition({
					context: validationContext,
					queryDefinition: input.queryDefinition,
					displayConfiguration: input.displayConfiguration,
				}),
			catch: (error) =>
				new BadRequest({ message: error instanceof Error ? error.message : String(error) }),
		});
	}).pipe(
		Effect.catchTag("NotFound", (error) => Effect.fail(new BadRequest({ message: error.message }))),
	);

export const prepareAndExecute = (userId: string, request: QueryEngineRequest) =>
	Effect.gen(function* () {
		const query = normalizeRequestPerMode(request);

		const context = yield* prepareContext({ userId, query });

		const eventSchemaMap =
			context.eventSchemaMap ??
			(yield* loadOptionalEventSchemaMap({
				userId,
				shouldLoad: hasEventAggregateRef(request),
				runtimeSchemas: context.runtimeSchemas,
				eventSchemaSlugs: context.eventSchemaSlugs,
			}));

		yield* tryQueryEngineSync(() =>
			validateQueryEngineReferences(request, {
				eventSchemaMap,
				schemaMap: context.schemaMap,
				eventJoinMap: context.eventJoinMap,
				eventSchemaSlugs: context.eventSchemaSlugs,
				relationshipJoinMap: context.relationshipJoinMap,
				supportsPrimaryEventRefs: request.mode === "events" || request.mode === "timeSeries",
			}),
		);

		const fullContext = { ...context, eventSchemaMap };

		return yield* Match.value(request).pipe(
			Match.when({ mode: "entities" }, (r) =>
				executePreparedQuery({ request: r, userId, context: fullContext }),
			),
			Match.when({ mode: "aggregate" }, (r) =>
				executeAggregateQuery({ request: r, userId, context: fullContext }),
			),
			Match.when({ mode: "events" }, (r) =>
				executeEventQuery({ request: r, userId, context: fullContext }),
			),
			Match.when({ mode: "timeSeries" }, (r) =>
				executeTimeSeriesQuery({ request: r, userId, context: fullContext }),
			),
			Match.exhaustive,
		);
	});
