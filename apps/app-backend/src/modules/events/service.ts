import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type { CreateEventItem, EventCreateOrigin } from "@ryot/contract/modules/events/schemas";
import type {
	Expr,
	QueryDocument,
	RowItem,
	RowsOutput,
} from "@ryot/contract/modules/query-engine/language";
import {
	EntityId,
	EventId,
	EventSchemaId,
	type EntitySchemaId,
	type ImportRunId,
	type IntegrationId,
	type UserId,
} from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { defaultUserPreferences } from "#modules/builtins/bootstrap";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import {
	getOptionalStringField,
	requireIsoStringField,
	requireRecordField,
	requireRowsResponse,
	requireStringField,
} from "#modules/query-engine/response-helpers";
import { QueryEngineService } from "#modules/query-engine/service";

import { enqueueEventCreate } from "./event-create-workflow";
import { validateEventCreateSubmission } from "./event-creation";
import { EventsRepository } from "./repository";

const eventAlias = "event";
const entityAlias = "entity";
const eventListPageSize = 100;
const entityNotFoundError = "Entity not found";
const sessionEntityNotFoundError = "Session entity not found";
const listScopeRequiredError = "Either entityId or sessionEntityId is required";

type EventCreateInput = {
	readonly userId: UserId;
	readonly executionId?: string;
	readonly source: EventCreateOrigin;
	readonly payload: ReadonlyArray<CreateEventItem>;
	readonly metadata?: {
		readonly importRunId?: ImportRunId;
		readonly integrationId?: IntegrationId;
	};
};

type EventListQuery = {
	readonly entityId?: EntityId | undefined;
	readonly eventSchemaSlug?: string | undefined;
	readonly sessionEntityId?: EntityId | undefined;
};

type EventQueryScope = {
	readonly eventSchemaSlugs: [string, ...string[]];
	readonly entitySchemaSlugs: [string, ...string[]];
};

const userFromId = (userId: UserId): CurrentUserValue => ({
	name: "",
	email: "",
	id: userId,
	preferences: defaultUserPreferences,
});

const eventSystemRef = (name: string): Expr => ({
	type: "ref",
	sourceAlias: eventAlias,
	field: { type: "system", name },
});

const eventSchemaMetaRef = (name: "name" | "slug"): Expr => ({
	type: "ref",
	sourceAlias: eventAlias,
	field: { type: "schema", name },
});

const literalExpr = (value: unknown): Expr => ({ type: "literal", value });

const eventComparison = (name: string, value: EntityId): Expr => ({
	operator: "eq",
	type: "comparison",
	right: literalExpr(value),
	left: eventSystemRef(name),
});

const nonEmptyStrings = (values: readonly string[]): [string, ...string[]] | null => {
	const unique = [...new Set(values.filter((value) => value.length > 0))];
	const [first, ...rest] = unique;
	return first === undefined ? null : [first, ...rest];
};

const nonEmptyAndExpr = (values: Expr[]): Expr | null => {
	const [first, ...rest] = values;
	if (first === undefined) {
		return null;
	}
	return rest.length === 0 ? first : { type: "and", values: [first, ...rest] };
};

const buildEventWhere = (query: EventListQuery): Expr | null => {
	const filters: Expr[] = [];
	if (query.entityId) {
		filters.push(eventComparison("entityId", query.entityId));
	}
	if (query.sessionEntityId) {
		filters.push(eventComparison("sessionEntityId", query.sessionEntityId));
	}

	return filters.length > 0 ? nonEmptyAndExpr(filters) : null;
};

const eventFields = [
	{ key: "id", expr: eventSystemRef("id") },
	{ key: "entityId", expr: eventSystemRef("entityId") },
	{ key: "createdAt", expr: eventSystemRef("createdAt") },
	{ key: "updatedAt", expr: eventSystemRef("updatedAt") },
	{ key: "occurredAt", expr: eventSystemRef("occurredAt") },
	{ key: "properties", expr: eventSystemRef("properties") },
	{ key: "eventSchemaId", expr: eventSystemRef("eventSchemaId") },
	{ key: "eventSchemaName", expr: eventSchemaMetaRef("name") },
	{ key: "eventSchemaSlug", expr: eventSchemaMetaRef("slug") },
	{ key: "sessionEntityId", expr: eventSystemRef("sessionEntityId") },
] satisfies RowsOutput["fields"];

const buildEventRowsDocument = (input: {
	page: number;
	query: EventListQuery;
	scope: EventQueryScope;
}) =>
	({
		source: {
			type: "events",
			alias: eventAlias,
			where: buildEventWhere(input.query),
			schemas: input.scope.eventSchemaSlugs,
			entity: { alias: entityAlias, schemas: input.scope.entitySchemaSlugs },
		},
		output: {
			type: "rows",
			fields: eventFields,
			pagination: { page: input.page, limit: eventListPageSize },
			orderBy: [
				{ order: "desc", expr: eventSystemRef("occurredAt") },
				{ order: "desc", expr: eventSystemRef("createdAt") },
				{ order: "desc", expr: eventSystemRef("id") },
			],
		},
	}) satisfies QueryDocument;

const toListedEvent = Effect.fn("toListedEventFromQueryEngine")(function* (row: RowItem) {
	const sessionEntityId = yield* getOptionalStringField(row, "sessionEntityId");

	return {
		properties: yield* requireRecordField(row, "properties"),
		id: EventId.make(yield* requireStringField(row, "id")),
		createdAt: yield* requireIsoStringField(row, "createdAt"),
		updatedAt: yield* requireIsoStringField(row, "updatedAt"),
		occurredAt: yield* requireIsoStringField(row, "occurredAt"),
		eventSchemaName: yield* requireStringField(row, "eventSchemaName"),
		eventSchemaSlug: yield* requireStringField(row, "eventSchemaSlug"),
		entityId: EntityId.make(yield* requireStringField(row, "entityId")),
		...(sessionEntityId ? { sessionEntityId: EntityId.make(sessionEntityId) } : {}),
		eventSchemaId: EventSchemaId.make(yield* requireStringField(row, "eventSchemaId")),
	};
});

export class EventsService extends Effect.Service<EventsService>()("EventsService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const repository = yield* EventsRepository;
		const queryEngine = yield* QueryEngineService;
		const entitiesRepository = yield* EntitiesRepository;
		const eventSchemasRepository = yield* EventSchemasRepository;

		const provideValidationContext = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			effect.pipe(
				Effect.provideService(DbRunner, runWithDb),
				Effect.provideService(EntitiesRepository, entitiesRepository),
				Effect.provideService(EventSchemasRepository, eventSchemasRepository),
			);

		const provideWorkflowEngine = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			effect.pipe(Effect.provideService(WorkflowEngine, engine));

		const requireReadableEntity = Effect.fn("EventsService.requireReadableEntity")(function* (
			userId: UserId,
			entityId: EntityId,
			notFoundMessage: string,
		) {
			const scope = yield* runWithDb(
				entitiesRepository.getEntityScopeForUser({ userId, entityId }),
			);
			if (!scope) {
				return yield* notFound(notFoundMessage);
			}

			return scope;
		});

		const resolveEntityEventQueryScope = Effect.fn("EventsService.resolveEntityEventQueryScope")(
			function* (
				userId: UserId,
				input: {
					eventSchemaSlug?: string | undefined;
					entitySchemaSlug: string;
					entitySchemaId: EntitySchemaId;
				},
			) {
				const eventSchemas = yield* runWithDb(
					eventSchemasRepository.listByEntitySchemaForUser({
						userId,
						entitySchemaId: input.entitySchemaId,
					}),
				);
				const filtered = input.eventSchemaSlug
					? eventSchemas.filter((schema) => schema.slug === input.eventSchemaSlug)
					: eventSchemas;
				const eventSchemaSlugs = nonEmptyStrings(filtered.map((schema) => schema.slug));
				const entitySchemaSlugs: [string, ...string[]] = [input.entitySchemaSlug];
				return eventSchemaSlugs ? { eventSchemaSlugs, entitySchemaSlugs } : null;
			},
		);

		const resolveSessionEventQueryScope = Effect.fn("EventsService.resolveSessionEventQueryScope")(
			function* (
				userId: UserId,
				query: { eventSchemaSlug?: string | undefined; sessionEntityId: EntityId },
			) {
				const rows = yield* runWithDb(repository.listQueryScopesForUser({ userId, ...query }));
				const eventSchemaSlugs = nonEmptyStrings(rows.map((row) => row.eventSchemaSlug));
				const entitySchemaSlugs = nonEmptyStrings(rows.map((row) => row.entitySchemaSlug));
				return eventSchemaSlugs && entitySchemaSlugs
					? { eventSchemaSlugs, entitySchemaSlugs }
					: null;
			},
		);

		const listEventsFromQueryEngine = Effect.fn("EventsService.listEventsFromQueryEngine")(
			function* (userId: UserId, scope: EventQueryScope, query: EventListQuery) {
				let page = 1;
				let hasMore = true;
				const items: RowItem[] = [];
				const user = userFromId(userId);

				while (hasMore) {
					const response = yield* queryEngine.execute(
						user,
						buildEventRowsDocument({ page, query, scope }),
					);
					const rows = yield* requireRowsResponse(response);
					items.push(...rows.data.items);
					hasMore = rows.data.pageInfo.hasMore;
					page += 1;
				}

				return yield* Effect.forEach(items, toListedEvent);
			},
		);

		const listForUser = Effect.fn("EventsService.listForUser")(function* (
			userId: UserId,
			query: EventListQuery,
		) {
			if (!query.entityId && !query.sessionEntityId) {
				return yield* badRequest(listScopeRequiredError);
			}

			let entityScope: { entitySchemaId: EntitySchemaId; entitySchemaSlug: string } | null = null;
			if (query.entityId) {
				entityScope = yield* requireReadableEntity(userId, query.entityId, entityNotFoundError);
			}

			if (query.sessionEntityId) {
				yield* requireReadableEntity(userId, query.sessionEntityId, sessionEntityNotFoundError);
			}

			let scope: EventQueryScope | null = null;
			if (entityScope) {
				scope = yield* resolveEntityEventQueryScope(userId, {
					eventSchemaSlug: query.eventSchemaSlug,
					entitySchemaId: entityScope.entitySchemaId,
					entitySchemaSlug: entityScope.entitySchemaSlug,
				});
			} else if (query.sessionEntityId) {
				scope = yield* resolveSessionEventQueryScope(userId, {
					eventSchemaSlug: query.eventSchemaSlug,
					sessionEntityId: query.sessionEntityId,
				});
			}

			return scope ? yield* listEventsFromQueryEngine(userId, scope, query) : [];
		});

		const create = Effect.fn("EventsService.create")(function* (input: EventCreateInput) {
			if (input.payload.length === 0) {
				return { count: 0 };
			}

			if (input.source === "integration" && !input.metadata?.integrationId) {
				return yield* badRequest("integrationId is required for integration event creation");
			}

			yield* provideValidationContext(
				validateEventCreateSubmission({ userId: input.userId, payload: input.payload }),
			);
			yield* provideWorkflowEngine(
				enqueueEventCreate({
					userId: input.userId,
					origin: input.source,
					payload: input.payload,
					executionId: input.executionId,
					importRunId: input.metadata?.importRunId,
					integrationId: input.metadata?.integrationId,
				}),
			);

			return { count: input.payload.length };
		});

		return { create, listForUser };
	}),
}) {}
