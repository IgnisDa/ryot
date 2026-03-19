import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createServiceErrorResult,
	createSuccessResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
} from "~/lib/openapi";
import {
	createEntityBody,
	createEntityResponseSchema,
	entityParams,
	getEntityResponseSchema,
} from "./schemas";
import { createEntity, getEntityDetail } from "./service";

const createEntityRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["entities"],
		summary: "Create an entity for a custom entity schema",
		request: {
			body: { content: { "application/json": { schema: createEntityBody } } },
		},
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity schema does not exist for this user"),
			200: jsonResponse("Entity was created", createEntityResponseSchema),
		},
	}),
);

const getEntityRoute = createAuthRoute(
	createRoute({
		method: "get",
		path: "/{entityId}",
		tags: ["entities"],
		summary: "Get a single custom entity",
		request: { params: entityParams },
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity does not exist for this user"),
			200: jsonResponse("Requested entity", getEntityResponseSchema),
		},
	}),
);

export const entitiesApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(getEntityRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const result = await getEntityDetail({
			entityId: params.entityId,
			userId: user.id,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(createEntityRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await createEntity({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
