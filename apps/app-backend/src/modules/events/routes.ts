import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import { resolveCustomEntityAccessError } from "~/lib/entity-schema-access";
import {
	createAuthRoute,
	createCustomEntityAccessErrorResult,
	createNotFoundErrorResult,
	createValidationErrorResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
	resolveValidationResult,
	successResponse,
} from "~/lib/openapi";
import {
	createEventForUser,
	getEntityScopeForUser,
	getEventCreateScopeForUser,
	listEventsByEntityForUser,
} from "./repository";
import {
	createEventBody,
	createEventResponseSchema,
	listEventsQuery,
	listEventsResponseSchema,
} from "./schemas";
import {
	resolveEntityEventAccess,
	resolveEventCreateAccess,
	resolveEventCreateInput,
	resolveEventEntityId,
	resolveEventSchemaId,
} from "./service";

const listEventsRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "get",
		tags: ["events"],
		request: { query: listEventsQuery },
		summary: "List events for a custom entity",
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity does not exist for this user"),
			200: jsonResponse(
				"Events for the requested entity",
				listEventsResponseSchema,
			),
		},
	}),
);

const createEventRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["events"],
		summary: "Create an event for a custom entity",
		request: {
			body: { content: { "application/json": { schema: createEventBody } } },
		},
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse(
				"Entity or event schema does not exist for this user",
			),
			200: jsonResponse("Event was created", createEventResponseSchema),
		},
	}),
);

const customEntitySchemaError =
	"Built-in entity schemas do not support generated event logging";
const entityNotFoundError = "Entity not found";
const eventSchemaNotFoundError = "Event schema not found";
const eventSchemaMismatchError =
	"Event schema does not belong to the entity schema";

const resolveEntityAccessError = (error: "builtin" | "not_found") => {
	return createCustomEntityAccessErrorResult(
		resolveCustomEntityAccessError({
			error,
			notFoundMessage: entityNotFoundError,
			builtinMessage: customEntitySchemaError,
		}),
	);
};

const resolveCreateAccessError = (
	error:
		| "builtin"
		| "not_found"
		| "event_schema_not_found"
		| "event_schema_mismatch",
) => {
	if (error === "builtin" || error === "not_found")
		return resolveEntityAccessError(error);

	if (error === "event_schema_not_found")
		return {
			status: 404 as const,
			body: createNotFoundErrorResult(eventSchemaNotFoundError).body,
		};

	return {
		status: 400 as const,
		body: createValidationErrorResult(eventSchemaMismatchError).body,
	};
};

export const eventsApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEventsRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");
		const entityId = resolveEventEntityId(query.entityId);

		const foundEntity = resolveEntityEventAccess(
			await getEntityScopeForUser({ entityId, userId: user.id }),
		);
		if ("error" in foundEntity) {
			const errorResult = resolveEntityAccessError(foundEntity.error);
			return c.json(errorResult.body, errorResult.status);
		}

		const events = await listEventsByEntityForUser({
			entityId,
			userId: user.id,
		});

		return c.json(successResponse(events), 200);
	})
	.openapi(createEventRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const entityId = resolveEventEntityId(body.entityId);
		const eventSchemaId = resolveEventSchemaId(body.eventSchemaId);

		const foundScope = resolveEventCreateAccess(
			await getEventCreateScopeForUser({
				entityId,
				eventSchemaId,
				userId: user.id,
			}),
		);
		if ("error" in foundScope) {
			const errorResult = resolveCreateAccessError(foundScope.error);
			return c.json(errorResult.body, errorResult.status);
		}

		const eventInput = resolveValidationResult(
			() =>
				resolveEventCreateInput({
					entityId: body.entityId,
					occurredAt: body.occurredAt,
					properties: body.properties,
					eventSchemaId: body.eventSchemaId,
					propertiesSchema: foundScope.access.propertiesSchema,
				}),
			"Event payload is invalid",
		);
		if ("error" in eventInput)
			return c.json(createValidationErrorResult(eventInput.error).body, 400);
		const eventData = eventInput.data;

		const createdEvent = await createEventForUser({
			userId: user.id,
			entityId: eventData.entityId,
			occurredAt: eventData.occurredAt,
			properties: eventData.properties,
			eventSchemaName: foundScope.access.eventSchemaName,
			eventSchemaSlug: foundScope.access.eventSchemaSlug,
			eventSchemaId: eventData.eventSchemaId,
		});

		return c.json(successResponse(createdEvent), 200);
	});
