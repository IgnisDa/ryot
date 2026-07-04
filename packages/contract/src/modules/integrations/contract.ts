import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { ImportRunId, IntegrationId } from "../../schema/brands";
import { ListedImportRun } from "../imports/schemas";
import {
	CreateIntegrationBody,
	IntegrationProvider,
	IntegrationWebhookPayload,
	ListedIntegration,
	UpdateIntegrationBody,
} from "./schemas";

export const IntegrationsGroup = HttpApiGroup.make("integrations")
	.annotate(OpenApi.Description, "Manage external service integrations and their import runs.")
	.add(
		HttpApiEndpoint.get("list", "/integrations", {
			query: {
				provider: Schema.optional(IntegrationProvider),
				isDisabled: Schema.optional(Schema.Boolean),
			},
			success: Schema.Array(ListedIntegration),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(
			OpenApi.Description,
			"List integrations, optionally filtered by provider or status.",
		),
	)
	.add(
		HttpApiEndpoint.post("create", "/integrations", {
			payload: CreateIntegrationBody,
			success: Schema.Struct({ id: Schema.String }).pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Create an external service integration."),
	)
	.add(
		HttpApiEndpoint.get("get", "/integrations/:integrationId", {
			params: { integrationId: IntegrationId },
			success: ListedIntegration,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Get an integration by ID."),
	)
	.add(
		HttpApiEndpoint.patch("update", "/integrations/:integrationId", {
			params: { integrationId: IntegrationId },
			payload: UpdateIntegrationBody,
			success: ListedIntegration,
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
	.add(
		HttpApiEndpoint.get("getRuns", "/integrations/:integrationId/runs", {
			params: { integrationId: IntegrationId },
			success: Schema.Array(ListedImportRun),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "List import runs for an integration."),
	)
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("webhook", "/webhooks/integrations/:integrationId", {
			params: { integrationId: IntegrationId },
			payload: IntegrationWebhookPayload,
			success: Schema.Struct({ runId: ImportRunId }).pipe(HttpApiSchema.status(202)),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Receive a webhook payload for an integration."),
	);
