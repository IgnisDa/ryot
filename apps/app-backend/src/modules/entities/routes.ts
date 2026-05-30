import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import { createAuthRoute, type AuthType } from "~/lib/auth";
import {
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	jsonBody,
} from "~/lib/openapi";

import {
	clearEntityUserStateResponseSchema,
	createEntityBody,
	createEntityResponseSchema,
	entityImportJobParams,
	entityParams,
	getEntityResponseSchema,
	importEntityBody,
	importEntityResponseSchema,
	importEntityResultResponseSchema,
} from "./schemas";
import { createEntity, getEntityDetail, getEntityImportResult, importEntity } from "./service";
import { clearEntityUserState } from "./user-state";

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
		tags: ["entities"],
		path: "/{entityId}",
		request: { params: entityParams },
		summary: "Get a single custom entity",
		responses: createStandardResponses({
			successSchema: getEntityResponseSchema,
			successDescription: "Requested entity",
			notFoundDescription: "Entity does not exist for this user",
		}),
	}),
);

const clearEntityUserStateRoute = createAuthRoute(
	createRoute({
		method: "delete",
		tags: ["entities"],
		path: "/{entityId}/user-state",
		request: { params: entityParams },
		summary: "Clear user-scoped state for an entity",
		description:
			"Delete the authenticated user's events and relationships touching this entity without deleting the entity row itself.",
		responses: createStandardResponses({
			successSchema: clearEntityUserStateResponseSchema,
			successDescription: "User-scoped entity state was cleared",
			notFoundDescription: "Entity does not exist for this user",
		}),
	}),
);

const importEntityRoute = createAuthRoute(
	createRoute({
		method: "post",
		path: "/import",
		tags: ["entities"],
		request: { body: jsonBody(importEntityBody) },
		summary: "Enqueue an entity import from a sandbox script",
		responses: createStandardResponses({
			successSchema: importEntityResponseSchema,
			successDescription: "Entity import job enqueued",
		}),
	}),
);

const getEntityImportResultRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["entities"],
		path: "/import/{jobId}",
		request: { params: entityImportJobParams },
		summary: "Poll the result of an entity import job",
		responses: createStandardResponses({
			successSchema: importEntityResultResponseSchema,
			successDescription: "Entity import job result",
			notFoundDescription: "Entity import job not found",
		}),
	}),
);

export const entitiesApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(importEntityRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await importEntity({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getEntityImportResultRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const result = await getEntityImportResult({ userId: user.id, jobId: params.jobId });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(clearEntityUserStateRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const result = await clearEntityUserState({ userId: user.id, entityId: params.entityId });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getEntityRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const result = await getEntityDetail({ userId: user.id, entityId: params.entityId });
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
