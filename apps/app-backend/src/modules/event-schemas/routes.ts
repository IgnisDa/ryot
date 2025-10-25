import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { fromJSONSchema } from "zod";
import type { AuthType } from "~/auth";
import {
	commonErrors,
	createAuthRoute,
	createErrorResponse,
	dataSchema,
	ERROR_CODES,
	errorResponse,
	jsonResponse,
	notFoundResponse,
	successResponse,
} from "~/lib/openapi";
import {
	createEventForSchema,
	getEntityByIdForUser,
	getEventSchemaByIdForUser,
	listEventSchemasByUser,
} from "./repository";
import {
	createEventBody,
	createEventParams,
	createEventResponse,
	listEventSchemasResponse,
} from "./schemas";

const listEventSchemasResponseSchema = dataSchema(listEventSchemasResponse);
const createEventResponseSchema = dataSchema(createEventResponse);

const parseEventProperties = (input: {
	propertiesSchema: unknown;
	providedProperties: Record<string, unknown>;
}) => {
	const propertiesParser = (() => {
		try {
			return fromJSONSchema(
				input.propertiesSchema as Parameters<typeof fromJSONSchema>[0],
			);
		} catch {
			return null;
		}
	})();

	if (!propertiesParser) return null;

	const parsedProperties = propertiesParser.safeParse(input.providedProperties);
	if (!parsedProperties.success) return null;

	const properties = parsedProperties.data;
	if (
		typeof properties !== "object" ||
		properties === null ||
		Array.isArray(properties)
	)
		return null;

	return properties as Record<string, unknown>;
};

const listEventSchemasRoute = createAuthRoute(
	createRoute({
		path: "/list",
		method: "get",
		tags: ["event-schemas"],
		summary: "List event schemas for the user",
		responses: {
			200: jsonResponse(
				"Event schemas available for the user",
				listEventSchemasResponseSchema,
			),
			500: createErrorResponse(
				"Failed to list event schemas",
				commonErrors.internalError,
			),
		},
	}),
);

const createEventRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["event-schemas"],
		path: "/{eventSchemaId}",
		summary: "Create an event for an event schema",
		request: {
			params: createEventParams,
			body: { content: { "application/json": { schema: createEventBody } } },
		},
		responses: {
			400: createErrorResponse(
				"Request validation failed",
				commonErrors.validationFailed,
			),
			404: notFoundResponse("Event schema or entity was not found"),
			500: createErrorResponse(
				"Failed to create event",
				commonErrors.internalError,
			),
			200: jsonResponse("Event was created", createEventResponseSchema),
		},
	}),
);

export const eventSchemasApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEventSchemasRoute, async (c) => {
		const user = c.get("user");
		const schemas = await listEventSchemasByUser(user.id);
		return c.json({ success: true, data: schemas }, 200);
	})
	.openapi(createEventRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const params = c.req.valid("param");

		const schema = await getEventSchemaByIdForUser({
			userId: user.id,
			eventSchemaId: params.eventSchemaId,
		});
		if (!schema)
			return c.json(
				errorResponse(ERROR_CODES.NOT_FOUND, "Event schema not found"),
				404,
			);

		const sourceEntity = await getEntityByIdForUser({
			userId: user.id,
			entityId: body.entityId,
			entitySchemaId: schema.entitySchemaId,
		});
		if (!sourceEntity)
			return c.json(
				errorResponse(
					ERROR_CODES.NOT_FOUND,
					"Entity not found for this event schema",
				),
				404,
			);

		if (body.sessionEntityId) {
			const sessionEntity = await getEntityByIdForUser({
				userId: user.id,
				entityId: body.sessionEntityId,
			});
			if (!sessionEntity)
				return c.json(
					errorResponse(ERROR_CODES.NOT_FOUND, "Session entity not found"),
					404,
				);
		}

		const parsedProperties = parseEventProperties({
			propertiesSchema: schema.propertiesSchema,
			providedProperties: body.properties,
		});
		if (!parsedProperties)
			return c.json(
				errorResponse(
					ERROR_CODES.VALIDATION_FAILED,
					"Event payload does not match schema properties",
				),
				400,
			);

		try {
			const createdEvent = await createEventForSchema({
				userId: user.id,
				entityId: body.entityId,
				properties: parsedProperties,
				occurredAt: body.occurredAt,
				eventSchemaId: params.eventSchemaId,
				sessionEntityId: body.sessionEntityId,
			});

			if (!createdEvent)
				return c.json(
					errorResponse(ERROR_CODES.INTERNAL_ERROR, "Event persistence failed"),
					500,
				);

			return c.json(successResponse({ eventId: createdEvent.id }), 200);
		} catch (error) {
			let errorMessage = "Event persistence failed";
			if (error instanceof Error)
				errorMessage = `${errorMessage}: ${error.message}`;
			return c.json(
				errorResponse(ERROR_CODES.INTERNAL_ERROR, errorMessage),
				500,
			);
		}
	});
