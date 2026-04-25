import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	jsonBody,
} from "~/lib/openapi";
import { sandboxJobParams } from "~/modules/sandbox";
import {
	createEntitySchemaBody,
	createEntitySchemaResponseSchema,
	entityImportJobParams,
	entitySchemaParams,
	entitySearchBody,
	entitySearchResponseSchema,
	entitySearchResultResponseSchema,
	importEntityBody,
	importEntityResponseSchema,
	importEntityResultResponseSchema,
	listEntitySchemasBody,
	listEntitySchemasResponseSchema,
} from "./schemas";
import {
	createEntitySchema,
	enqueueEntitySearch,
	getEntityImportResult,
	getEntitySchemaById,
	getEntitySearchResult,
	importEntity,
	listEntitySchemas,
} from "./service";

const listEntitySchemasRoute = createAuthRoute(
	createRoute({
		path: "/list",
		method: "post",
		tags: ["entity-schemas"],
		request: { body: jsonBody(listEntitySchemasBody) },
		summary: "List entity schemas with optional tracker or slug filters",
		responses: createStandardResponses({
			successSchema: listEntitySchemasResponseSchema,
			notFoundDescription: "Tracker does not exist for this user",
			successDescription: "Entity schemas for the requested filters or user",
		}),
	}),
);

const createEntitySchemaRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["entity-schemas"],
		summary: "Create an entity schema for a custom tracker",
		request: { body: jsonBody(createEntitySchemaBody) },
		responses: createStandardResponses({
			successDescription: "Entity schema was created",
			successSchema: createEntitySchemaResponseSchema,
			notFoundDescription: "Tracker does not exist for this user",
		}),
	}),
);

const getEntitySchemaRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["entity-schemas"],
		path: "/{entitySchemaId}",
		request: { params: entitySchemaParams },
		summary: "Get a single entity schema by ID",
		responses: createStandardResponses({
			successDescription: "Requested entity schema",
			successSchema: createEntitySchemaResponseSchema,
			notFoundDescription: "Entity schema does not exist for this user",
		}),
	}),
);

const importEntityRoute = createAuthRoute(
	createRoute({
		method: "post",
		path: "/import",
		tags: ["entity-schemas"],
		request: { body: jsonBody(importEntityBody) },
		summary: "Enqueue a media entity import from a sandbox script",
		responses: createStandardResponses({
			successSchema: importEntityResponseSchema,
			successDescription: "Entity import job enqueued",
		}),
	}),
);

const getEntityImportResultRoute = createAuthRoute(
	createRoute({
		method: "get",
		path: "/import/{jobId}",
		tags: ["entity-schemas"],
		request: { params: entityImportJobParams },
		summary: "Poll the result of an entity import job",
		responses: createStandardResponses({
			successSchema: importEntityResultResponseSchema,
			successDescription: "Entity import job result",
			notFoundDescription: "Entity import job not found",
		}),
	}),
);

const enqueueEntitySearchRoute = createAuthRoute(
	createRoute({
		method: "post",
		path: "/search",
		tags: ["entity-schemas"],
		request: { body: jsonBody(entitySearchBody) },
		summary:
			"Enqueue an entity search using the search driver of a sandbox script",
		responses: createStandardResponses({
			successSchema: entitySearchResponseSchema,
			notFoundDescription: "Sandbox script not found",
			successDescription: "Entity search job enqueued",
		}),
	}),
);

const getEntitySearchResultRoute = createAuthRoute(
	createRoute({
		method: "get",
		path: "/search/{jobId}",
		tags: ["entity-schemas"],
		request: { params: sandboxJobParams },
		summary: "Poll the result of an entity search job",
		responses: createStandardResponses({
			successDescription: "Entity search job result",
			successSchema: entitySearchResultResponseSchema,
			notFoundDescription: "Entity search job not found",
		}),
	}),
);

export const entitySchemasApi = new OpenAPIHono<{ Variables: AuthType }>()
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

		const result = await getEntityImportResult({
			userId: user.id,
			jobId: params.jobId,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(listEntitySchemasRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await listEntitySchemas({
			userId: user.id,
			slugs: body.slugs,
			trackerId: body.trackerId,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(createEntitySchemaRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await createEntitySchema({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(enqueueEntitySearchRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await enqueueEntitySearch({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getEntitySearchResultRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const result = await getEntitySearchResult({
			jobId: params.jobId,
			userId: user.id,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getEntitySchemaRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const result = await getEntitySchemaById({
			userId: user.id,
			entitySchemaId: params.entitySchemaId,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
