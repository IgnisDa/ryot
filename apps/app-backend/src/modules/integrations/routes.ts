import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { Hono } from "hono";

import { createAuthRoute, type AuthType } from "~/lib/auth";
import {
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	jsonBody,
	jsonResponse,
	listDataSchema,
} from "~/lib/openapi";
import { listedImportRunSchema } from "~/modules/imports/schemas";

import {
	createIntegrationBody,
	createIntegrationResponseSchema,
	getIntegrationResponseSchema,
	integrationIdParams,
	listIntegrationsQuery,
	listIntegrationsResponseSchema,
	patchIntegrationBody,
	webhookResponseSchema,
} from "./schemas";
import {
	createIntegration,
	deleteIntegration,
	getIntegration,
	handleWebhook,
	listIntegrationRuns,
	listIntegrations,
	patchIntegration,
} from "./service";

const listIntegrationsRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "get",
		tags: ["integrations"],
		request: { query: listIntegrationsQuery },
		summary: "List integrations for the current user",
		responses: createStandardResponses({
			includePayloadError: false,
			successSchema: listIntegrationsResponseSchema,
			successDescription: "Integrations for the current user",
		}),
	}),
);

const createIntegrationRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["integrations"],
		summary: "Create a new integration",
		request: { body: jsonBody(createIntegrationBody) },
		responses: createStandardResponses({
			successDescription: "Integration created",
			successSchema: createIntegrationResponseSchema,
		}),
	}),
);

const getIntegrationRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["integrations"],
		path: "/{integrationId}",
		summary: "Get an integration by ID",
		request: { params: integrationIdParams },
		responses: createStandardResponses({
			successSchema: getIntegrationResponseSchema,
			successDescription: "Integration details",
			notFoundDescription: "Integration not found",
		}),
	}),
);

const patchIntegrationRoute = createAuthRoute(
	createRoute({
		method: "patch",
		tags: ["integrations"],
		path: "/{integrationId}",
		summary: "Update an integration",
		request: { params: integrationIdParams, body: jsonBody(patchIntegrationBody) },
		responses: createStandardResponses({
			successSchema: getIntegrationResponseSchema,
			successDescription: "Integration updated",
			notFoundDescription: "Integration not found",
		}),
	}),
);

const deleteIntegrationRoute = createAuthRoute(
	createRoute({
		method: "delete",
		tags: ["integrations"],
		path: "/{integrationId}",
		summary: "Delete an integration and its run history",
		request: { params: integrationIdParams },
		responses: createStandardResponses({
			includePayloadError: false,
			successDescription: "Integration deleted",
			notFoundDescription: "Integration not found",
			successSchema: createIntegrationResponseSchema,
		}),
	}),
);

const listIntegrationRunsRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["integrations"],
		path: "/{integrationId}/runs",
		request: { params: integrationIdParams },
		summary: "List import runs for an integration",
		responses: createStandardResponses({
			includePayloadError: false,
			notFoundDescription: "Integration not found",
			successDescription: "Import runs for the integration",
			successSchema: listDataSchema(listedImportRunSchema),
		}),
	}),
);

export const integrationsApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listIntegrationsRoute, async (c) => {
		const user = c.get("user");
		const { provider, isDisabled } = c.req.valid("query");
		const result = await listIntegrations({ userId: user.id, provider, isDisabled });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}
		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(createIntegrationRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const result = await createIntegration({ userId: user.id, body });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}
		const response = createSuccessResult({ id: result.data.id });
		return c.json(response.body, response.status);
	})
	.openapi(getIntegrationRoute, async (c) => {
		const user = c.get("user");
		const { integrationId } = c.req.valid("param");
		const result = await getIntegration({ id: integrationId, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}
		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(patchIntegrationRoute, async (c) => {
		const user = c.get("user");
		const { integrationId } = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await patchIntegration({ id: integrationId, userId: user.id, body });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}
		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(deleteIntegrationRoute, async (c) => {
		const user = c.get("user");
		const { integrationId } = c.req.valid("param");
		const result = await deleteIntegration({ id: integrationId, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}
		const response = createSuccessResult({ id: integrationId });
		return c.json(response.body, response.status);
	})
	.openapi(listIntegrationRunsRoute, async (c) => {
		const user = c.get("user");
		const { integrationId } = c.req.valid("param");
		const result = await listIntegrationRuns({
			integrationId,
			userId: user.id,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}
		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});

const processWebhookRequest = async (c: Context) => {
	const integrationId = c.req.param("integrationId");
	if (!integrationId) {
		return c.json({ error: { message: "Integration ID required", code: "NOT_FOUND" } }, 404);
	}

	const rawBody = await c.req.text();
	const contentType = c.req.header("content-type") ?? "application/json";

	const result = await handleWebhook({ integrationId, rawBody, contentType });

	if ("notFound" in result) {
		return c.json({ error: { message: "Integration not found", code: "NOT_FOUND" } }, 404);
	}
	if ("notSink" in result) {
		return c.json(
			{ error: { message: "Integration is not a sink integration", code: "VALIDATION_FAILED" } },
			400,
		);
	}

	return c.json({ data: { runId: result.runId } }, 202);
};

const webhookRoute = createRoute({
	method: "post",
	tags: ["integrations"],
	path: "/{integrationId}",
	summary: "Receive a webhook payload for a Sink integration",
	request: { params: integrationIdParams },
	responses: {
		202: jsonResponse("Webhook accepted", webhookResponseSchema),
		404: jsonResponse(
			"Integration not found",
			z.object({ error: z.object({ message: z.string(), code: z.string() }) }),
		),
		400: jsonResponse(
			"Not a sink integration",
			z.object({ error: z.object({ message: z.string(), code: z.string() }) }),
		),
	},
});

export const integrationWebhooksApi = new OpenAPIHono().openapi(
	webhookRoute,
	processWebhookRequest,
);

export const integrationShortWebhookApp = new Hono().post("/:integrationId", processWebhookRequest);
