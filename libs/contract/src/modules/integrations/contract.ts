import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { NotFound, RateLimited, Unauthorized } from "../../errors";
import { ImportRunId, IntegrationId } from "../../schema/brands";
import { ListedImportRun } from "../imports/schemas";
import {
	CreateIntegrationBody,
	IntegrationProvider,
	IntegrationWebhookPayload,
	ListedIntegration,
	UpdateIntegrationBody,
} from "./schemas";

const integrationIdParam = HttpApiSchema.param("integrationId", IntegrationId);

export const IntegrationsGroup = HttpApiGroup.make("integrations")
	.annotate(OpenApi.Description, "Manage external service integrations and their import runs.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.get("list", "/integrations")
			.annotate(
				OpenApi.Description,
				"List integrations, optionally filtered by provider or status.",
			)
			.setUrlParams(
				Schema.Struct({
					provider: Schema.optional(IntegrationProvider),
					isDisabled: Schema.optional(Schema.BooleanFromString),
				}),
			)
			.addSuccess(Schema.Array(ListedIntegration)),
	)
	.add(
		HttpApiEndpoint.post("create", "/integrations")
			.annotate(OpenApi.Description, "Create an external service integration.")
			.setPayload(CreateIntegrationBody)
			.addSuccess(Schema.Struct({ id: Schema.String }), { status: 201 }),
	)
	.add(
		HttpApiEndpoint.get("get")`/integrations/${integrationIdParam}`
			.annotate(OpenApi.Description, "Get an integration by ID.")
			.addSuccess(ListedIntegration)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.patch("update")`/integrations/${integrationIdParam}`
			.annotate(OpenApi.Description, "Update an integration by ID.")
			.setPayload(UpdateIntegrationBody)
			.addSuccess(ListedIntegration)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.del("delete")`/integrations/${integrationIdParam}`
			.annotate(OpenApi.Description, "Delete an integration by ID.")
			.addSuccess(Schema.Struct({ id: Schema.String }))
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("getRuns")`/integrations/${integrationIdParam}/runs`
			.annotate(OpenApi.Description, "List import runs for an integration.")
			.addSuccess(Schema.Array(ListedImportRun))
			.addError(NotFound, { status: 404 }),
	)
	.middlewareEndpoints(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("webhook")`/webhooks/integrations/${integrationIdParam}`
			.annotate(OpenApi.Description, "Receive a webhook payload for an integration.")
			.setPayload(IntegrationWebhookPayload)
			.addSuccess(Schema.Struct({ runId: ImportRunId }), { status: 202 })
			.addError(NotFound, { status: 404 }),
	);
