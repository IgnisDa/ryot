import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { ImportRunId, IntegrationId, IntegrationWebhookToken } from "../../schema/brands";
import {
	CreateIntegrationBody,
	IntegrationNotFoundError,
	IntegrationRequestError,
	IntegrationWebhookBody,
	integrationWebhookContentTypes,
	UpdateIntegrationBody,
} from "./schemas";

export const IntegrationsGroup = HttpApiGroup.make("integrations")
	.annotate(OpenApi.Description, "Manage external service integrations and their import runs.")
	.add(
		AuthenticatedMutationEndpoint.post("protected")("create", "/integrations", {
			payload: CreateIntegrationBody,
			error: [IntegrationRequestError.pipe(HttpApiSchema.status(400))],
			success: Schema.Struct({ id: IntegrationId }).pipe(HttpApiSchema.status(201)),
		}).annotate(OpenApi.Description, "Create an external service integration."),
	)
	.add(
		AuthenticatedMutationEndpoint.patch("protected")("update", "/integrations/:integrationId", {
			payload: UpdateIntegrationBody,
			params: { integrationId: IntegrationId },
			success: Schema.Struct({ id: IntegrationId }),
			error: [
				IntegrationRequestError.pipe(HttpApiSchema.status(400)),
				IntegrationNotFoundError.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Update an integration by ID."),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("protected")("delete", "/integrations/:integrationId", {
			params: { integrationId: IntegrationId },
			success: Schema.Struct({ id: Schema.String }),
			error: [IntegrationNotFoundError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Delete an integration by ID."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("sync", "/integrations/sync", {
			error: [IntegrationRequestError.pipe(HttpApiSchema.status(400))],
			success: Schema.Struct({ executionId: Schema.String }).pipe(HttpApiSchema.status(202)),
		}).annotate(OpenApi.Description, "Start synchronization for the current user's integrations."),
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
