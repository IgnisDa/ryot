import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy } from "../../http-annotations";
import { ImportRunId, IntegrationId, IntegrationWebhookToken } from "../../schema/brands";
import {
	CreateIntegrationBody,
	IntegrationNotFoundError,
	IntegrationRequestError,
	IntegrationWebhookBody,
	integrationWebhookContentTypes,
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
			error: [IntegrationNotFoundError.pipe(HttpApiSchema.status(404))],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Get an integration by ID."),
	)
	.add(
		HttpApiEndpoint.post("create", "/integrations", {
			payload: CreateIntegrationBody,
			success: ListedIntegration.pipe(HttpApiSchema.status(201)),
			error: [IntegrationRequestError.pipe(HttpApiSchema.status(400))],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Create an external service integration."),
	)
	.add(
		HttpApiEndpoint.patch("update", "/integrations/:integrationId", {
			success: ListedIntegration,
			payload: UpdateIntegrationBody,
			params: { integrationId: IntegrationId },
			error: [
				IntegrationRequestError.pipe(HttpApiSchema.status(400)),
				IntegrationNotFoundError.pipe(HttpApiSchema.status(404)),
			],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Update an integration by ID."),
	)
	.add(
		HttpApiEndpoint.delete("delete", "/integrations/:integrationId", {
			params: { integrationId: IntegrationId },
			success: Schema.Struct({ id: Schema.String }),
			error: [IntegrationNotFoundError.pipe(HttpApiSchema.status(404))],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Delete an integration by ID."),
	)
	.add(
		HttpApiEndpoint.post("sync", "/integrations/sync", {
			error: [IntegrationRequestError.pipe(HttpApiSchema.status(400))],
			success: Schema.Struct({ executionId: Schema.String }).pipe(HttpApiSchema.status(202)),
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Start synchronization for the current user's integrations."),
	)
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("webhook", "/webhooks/integrations/:webhookToken", {
			params: { webhookToken: IntegrationWebhookToken },
			success: Schema.Struct({ runId: ImportRunId }).pipe(HttpApiSchema.status(202)),
			error: [
				IntegrationRequestError.pipe(HttpApiSchema.status(400)),
				IntegrationNotFoundError.pipe(HttpApiSchema.status(404)),
			],
			payload: integrationWebhookContentTypes.map((contentType) =>
				IntegrationWebhookBody.pipe(HttpApiSchema.asText({ contentType })),
			),
		}).annotate(
			OpenApi.Description,
			"Receive an integration webhook payload using its secret capability token.",
		),
	);
