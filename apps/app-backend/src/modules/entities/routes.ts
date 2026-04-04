import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	jsonBody,
} from "~/lib/openapi";
import {
	createEntityBody,
	createEntityResponseSchema,
	createEntityWithCollectionBody,
	createEntityWithCollectionResponseSchema,
	entityParams,
	getEntityResponseSchema,
} from "./schemas";
import {
	createEntity,
	createEntityWithCollection,
	getEntityDetail,
} from "./service";

const createEntityRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["entities"],
		request: { body: jsonBody(createEntityBody) },
		summary: "Create an entity for a custom entity schema",
		responses: createStandardResponses({
			successDescription: "Entity was created",
			successSchema: createEntityResponseSchema,
			notFoundDescription: "Entity schema does not exist for this user",
		}),
	}),
);

const getEntityRoute = createAuthRoute(
	createRoute({
		method: "get",
		path: "/{entityId}",
		tags: ["entities"],
		request: { params: entityParams },
		summary: "Get a single custom entity",
		responses: createStandardResponses({
			successDescription: "Requested entity",
			successSchema: getEntityResponseSchema,
			notFoundDescription: "Entity does not exist for this user",
		}),
	}),
);

const createEntityWithCollectionRoute = createAuthRoute(
	createRoute({
		path: "/with-collection",
		method: "post",
		tags: ["entities"],
		request: { body: jsonBody(createEntityWithCollectionBody) },
		summary: "Create an entity and add it to a collection atomically",
		description:
			"Creates an entity and adds it to a collection in a single transaction. If either operation fails, both are rolled back.",
		responses: createStandardResponses({
			successDescription: "Entity was created and added to collection",
			successSchema: createEntityWithCollectionResponseSchema,
			notFoundDescription: "Entity schema does not exist for this user",
		}),
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
	})
	.openapi(createEntityWithCollectionRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await createEntityWithCollection({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
