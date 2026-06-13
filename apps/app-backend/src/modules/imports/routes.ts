import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import { createAuthRoute, type AuthType } from "~/lib/auth";
import {
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	jsonBody,
} from "~/lib/openapi";

import {
	createImportRunBody,
	createImportRunResponseSchema,
	getImportRunQuery,
	getImportRunResponseSchema,
	importRunParams,
	listImportRunsResponseSchema,
} from "./schemas";
import { getImportRun, listImportRuns, removeImportRun, startImportRun } from "./service";

const createImportRunRoute = createAuthRoute(
	createRoute({
		path: "/runs",
		method: "post",
		tags: ["imports"],
		summary: "Start a new import run",
		request: { body: jsonBody(createImportRunBody) },
		responses: createStandardResponses({
			successSchema: createImportRunResponseSchema,
			successDescription: "Import run created and enqueued",
		}),
	}),
);

const listImportRunsRoute = createAuthRoute(
	createRoute({
		path: "/runs",
		method: "get",
		tags: ["imports"],
		summary: "List import runs for the current user",
		responses: createStandardResponses({
			includePayloadError: false,
			successSchema: listImportRunsResponseSchema,
			successDescription: "Import runs for the current user",
		}),
	}),
);

const getImportRunRoute = createAuthRoute(
	createRoute({
		path: "/runs/{runId}",
		method: "get",
		tags: ["imports"],
		summary: "Get an import run by ID",
		request: { params: importRunParams, query: getImportRunQuery },
		responses: createStandardResponses({
			successDescription: "Import run details",
			successSchema: getImportRunResponseSchema,
			notFoundDescription: "Import run not found",
		}),
	}),
);

const deleteImportRunRoute = createAuthRoute(
	createRoute({
		method: "delete",
		tags: ["imports"],
		path: "/runs/{runId}",
		summary: "Delete a terminal import run",
		request: { params: importRunParams },
		responses: createStandardResponses({
			successDescription: "Import run deleted",
			notFoundDescription: "Import run not found",
			successSchema: createImportRunResponseSchema,
		}),
	}),
);

export const importsApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(createImportRunRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const result = await startImportRun({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}
		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(listImportRunsRoute, async (c) => {
		const user = c.get("user");
		const result = await listImportRuns({ userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}
		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getImportRunRoute, async (c) => {
		const user = c.get("user");
		const { runId } = c.req.valid("param");
		const { page, limit } = c.req.valid("query");
		const result = await getImportRun({ runId, userId: user.id, page, limit });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}
		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(deleteImportRunRoute, async (c) => {
		const user = c.get("user");
		const { runId } = c.req.valid("param");
		const result = await removeImportRun({ runId, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}
		const response = createSuccessResult({ id: runId });
		return c.json(response.body, response.status);
	});
