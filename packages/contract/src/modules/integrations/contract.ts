import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { ImportRunId, IntegrationId } from "../../schema/brands";
import {
	CreateIntegrationBody,
	IntegrationWebhookPayload,
	ListedIntegration,
	ListedIntegrationProvider,
	UpdateIntegrationBody,
} from "./schemas";

export const IntegrationsGroup = HttpApiGroup.make("integrations")
	.annotate(OpenApi.Description, "Manage external service integrations and their import runs.")
	.add(
		HttpApiEndpoint.get("listProviders", "/integrations/providers", {
			success: Schema.Array(ListedIntegrationProvider),
		}).annotate(OpenApi.Description, "List available integration providers."),
	)
	.add(
		HttpApiEndpoint.get("get", "/integrations/:integrationId", {
			success: ListedIntegration,
			params: { integrationId: IntegrationId },
			error: [NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Get an integration by ID."),
	)
	.add(
		HttpApiEndpoint.post("create", "/integrations", {
			payload: CreateIntegrationBody,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
			success: ListedIntegration.pipe(HttpApiSchema.status(201)),
		}).annotate(OpenApi.Description, "Create an external service integration."),
	)
	.add(
		HttpApiEndpoint.patch("update", "/integrations/:integrationId", {
			success: ListedIntegration,
			payload: UpdateIntegrationBody,
			params: { integrationId: IntegrationId },
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Update an integration by ID."),
	)
	.add(
		HttpApiEndpoint.delete("delete", "/integrations/:integrationId", {
			params: { integrationId: IntegrationId },
			success: Schema.Struct({ id: Schema.String }),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Delete an integration by ID."),
	)
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("webhook", "/webhooks/integrations/:integrationId", {
			payload: IntegrationWebhookPayload,
			params: { integrationId: IntegrationId },
			success: Schema.Struct({ runId: ImportRunId }).pipe(HttpApiSchema.status(202)),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Receive a webhook payload for an integration."),
	);
