import { Effect } from "effect";
import { match } from "ts-pattern";

import type { CurrentDb } from "~/lib/db";
import type { DbError } from "~/lib/errors";
import { BadRequest, NotFound } from "~/lib/errors";
import type {
	QueryEngineRequest,
	QueryEventJoin,
	QueryRelationshipJoin,
} from "~/lib/query-language";
import { QueryEngineNotFoundError } from "~/lib/views/errors";
import {
	buildEventJoinMap,
	buildRelationshipJoinMap,
	buildSchemaMap,
	type QueryEngineEventSchemaLike,
} from "~/lib/views/reference";
import { validateQueryEngineReferences } from "~/lib/views/validator";

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
	return match(request)
		.with({ mode: "entities" }, { mode: "aggregate" }, (r) => ({
			mode: r.mode,
			scope: [...r.scope],
			eventJoins: r.eventJoins ? [...r.eventJoins] : [],
			eventSchemas: [] as string[],
			relationshipJoins: r.relationshipJoins ? [...r.relationshipJoins] : [],
		}))
		.with({ mode: "events" }, (r) => ({
			mode: r.mode,
			scope: [...r.scope],
			eventJoins: r.eventJoins ? [...r.eventJoins] : [],
			eventSchemas: [...r.eventSchemas],
			relationshipJoins: [],
		}))
		.with({ mode: "timeSeries" }, (r) => ({
			mode: r.mode,
			scope: [...r.scope],
			eventSchemas: [...r.eventSchemas],
			eventJoins: [],
			relationshipJoins: [],
		}))
		.exhaustive();
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

		return yield* match(request)
			.with({ mode: "entities" }, (r) =>
				executePreparedQuery({ request: r, userId, context: fullContext }),
			)
			.with({ mode: "aggregate" }, (r) =>
				executeAggregateQuery({ request: r, userId, context: fullContext }),
			)
			.with({ mode: "events" }, (r) =>
				executeEventQuery({ request: r, userId, context: fullContext }),
			)
			.with({ mode: "timeSeries" }, (r) =>
				executeTimeSeriesQuery({ request: r, userId, context: fullContext }),
			)
			.exhaustive();
	});
