import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/auth";
import {
	commonErrors,
	createAuthRoute,
	createErrorResponse,
	dataSchema,
	jsonResponse,
} from "~/lib/openapi";
import { listEventSchemasByUser } from "./repository";
import { listEventSchemasResponse } from "./schemas";

const listEventSchemasResponseSchema = dataSchema(listEventSchemasResponse);

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

export const eventSchemasApi = new OpenAPIHono<{
	Variables: AuthType;
}>().openapi(listEventSchemasRoute, async (c) => {
	const user = c.get("user");
	const schemas = await listEventSchemasByUser(user.id);
	return c.json({ success: true, data: schemas }, 200);
});
