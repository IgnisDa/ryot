import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { type CurrentUserValue, defaultUserPreferences } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import type { CreateEventItem, EventCreateOrigin } from "@ryot/contract/modules/events/schemas";
import type { RowItem } from "@ryot/contract/modules/query-engine/language";
import {
	EntityId,
	EventId,
	EventSchemaId,
	type EntitySchemaId,
	type ImportRunId,
	type IntegrationId,
	type UserId,
} from "@ryot/contract/schema/brands";
import { buildEventHistoryQueryDocument } from "@ryot/query-engine";
import { Effect, Match } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
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
import {
	EventsRepository,
	type EventIdentityInput,
	type UpdateEventEntityReferencesInput,
} from "./repository";

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

const toLifecycleOrigin = (input: EventCreateInput): AutomationOrigin | undefined => {
	const importRunId = input.metadata?.importRunId;
	const integrationId = input.metadata?.integrationId;
	return Match.value(input.source).pipe(
		Match.when("api", () => ({ kind: "api" }) as const),
		Match.when(
			"import",
			() => ({ kind: "import", ...(importRunId ? { importRunId } : {}) }) as const,
		),
		Match.when("integration", () =>
			integrationId
				? ({ kind: "integration", integrationId, ...(importRunId ? { importRunId } : {}) } as const)
				: undefined,
		),
		Match.when("sandbox", () =>
			input.executionId
				? ({ kind: "automation", executionId: input.executionId } as const)
				: undefined,
		),
		Match.orElse(() => undefined),
	);
};

const userFromId = (userId: UserId): CurrentUserValue => ({
	name: "",
	email: "",
	id: userId,
	preferences: defaultUserPreferences,
});

const nonEmptyStrings = (values: readonly string[]): [string, ...string[]] | null => {
	const unique = [...new Set(values.filter((value) => value.length > 0))];
	const [first, ...rest] = unique;
	return first === undefined ? null : [first, ...rest];
};

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
						buildEventHistoryQueryDocument({
							page,
							entityId: query.entityId,
							sessionEntityId: query.sessionEntityId,
							eventSchemaSlugs: scope.eventSchemaSlugs,
							entitySchemaSlugs: scope.entitySchemaSlugs,
						}),
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
				return { count: 0, outcomes: [], failure: null };
			}

			if (input.source === "integration" && !input.metadata?.integrationId) {
				return yield* badRequest("integrationId is required for integration event creation");
			}

			return yield* provideWorkflowEngine(
				enqueueEventCreate({
					userId: input.userId,
					origin: input.source,
					payload: input.payload,
					executionId: input.executionId,
					importRunId: input.metadata?.importRunId,
					lifecycleOrigin: toLifecycleOrigin(input),
					integrationId: input.metadata?.integrationId,
				}),
			);
		});

		const update = Effect.fn("EventsService.update")(function* (
			input: UpdateEventEntityReferencesInput,
		) {
			return yield* runWithDb(repository.updateEventEntityReferences(input));
		});

		const deleteEvent = Effect.fn("EventsService.delete")(function* (input: EventIdentityInput) {
			return yield* runWithDb(repository.deleteEvent(input));
		});

		return { create, delete: deleteEvent, listForUser, update };
	}),
}) {}
