import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "#lib/auth-middleware";
import { BadRequest, NotFound, NotImplemented, RateLimited, Unauthorized } from "#lib/errors";
import { ListedImportRun } from "#modules/imports/schemas";

import {
	CreateIntegrationBody,
	IntegrationProvider,
	ListedIntegration,
	UpdateIntegrationBody,
} from "./schemas";

const integrationIdParam = HttpApiSchema.param("integrationId", Schema.String);

export const IntegrationsGroup = HttpApiGroup.make("integrations")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.get("list", "/integrations")
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
			.setPayload(CreateIntegrationBody)
			.addError(BadRequest, { status: 400 })
			.addSuccess(Schema.Struct({ id: Schema.String }), { status: 201 }),
	)
	.add(
		HttpApiEndpoint.get("get")`/integrations/${integrationIdParam}`
			.addSuccess(ListedIntegration)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.patch("update")`/integrations/${integrationIdParam}`
			.setPayload(UpdateIntegrationBody)
			.addSuccess(ListedIntegration)
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.del("delete")`/integrations/${integrationIdParam}`
			.addSuccess(Schema.Struct({ id: Schema.String }))
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("getRuns")`/integrations/${integrationIdParam}/runs`
			.addSuccess(Schema.Array(ListedImportRun))
			.addError(NotFound, { status: 404 }),
	)
	.middlewareEndpoints(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("webhook")`/webhooks/integrations/${integrationIdParam}`
			.addSuccess(Schema.Struct({ runId: Schema.String }), { status: 202 })
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 }),
	)
	.addError(NotImplemented, { status: 501 });
