import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
	resolveCustomEntityAccessError,
	resolveCustomEntitySchemaAccess,
} from "~/lib/app/entity-schema-access";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createCustomEntityAccessErrorResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
	successResponse,
} from "~/lib/openapi";
import {
	getEntitySchemaScopeForUser,
	listEntitiesByEntitySchemaForUser,
} from "../entities/repository";
import { resolveEntitySchemaId } from "../entities/service";
import {
	executeViewRuntimeBody,
	executeViewRuntimeResponseSchema,
} from "./schemas";

const executeViewRuntimeRoute = createAuthRoute(
	createRoute({
		method: "post",
		path: "/execute",
		tags: ["view-runtime"],
		request: {
			body: {
				content: { "application/json": { schema: executeViewRuntimeBody } },
			},
		},
		summary: "Execute a view-runtime query for a custom entity schema",
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity schema does not exist for this user"),
			200: jsonResponse(
				"Entities for the requested runtime query",
				executeViewRuntimeResponseSchema,
			),
		},
	}),
);

const customEntitySchemaError =
	"Built-in entity schemas do not support manual entity creation";
const entitySchemaNotFoundError = "Entity schema not found";

const resolveEntitySchemaAccessError = (error: "builtin" | "not_found") => {
	return createCustomEntityAccessErrorResult(
		resolveCustomEntityAccessError({
			error,
			builtinMessage: customEntitySchemaError,
			notFoundMessage: entitySchemaNotFoundError,
		}),
	);
};

export const viewRuntimeApi = new OpenAPIHono<{
	Variables: AuthType;
}>().openapi(executeViewRuntimeRoute, async (c) => {
	const user = c.get("user");
	const body = c.req.valid("json");
	const entitySchemaId = resolveEntitySchemaId(body.entitySchemaId);

	const foundEntitySchema = resolveCustomEntitySchemaAccess(
		await getEntitySchemaScopeForUser({
			entitySchemaId,
			userId: user.id,
		}),
	);
	if (!("entitySchema" in foundEntitySchema)) {
		const errorResult = resolveEntitySchemaAccessError(foundEntitySchema.error);
		return c.json(errorResult.body, errorResult.status);
	}

	const entities = await listEntitiesByEntitySchemaForUser({
		entitySchemaId,
		userId: user.id,
	});

	return c.json(successResponse(entities), 200);
});
