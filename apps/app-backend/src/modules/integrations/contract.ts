import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "~/lib/auth";
import { NotFound, NotImplemented, RateLimited, Unauthorized } from "~/lib/errors";
import { ListedImportRun } from "~/modules/imports/schemas";

import { CreateIntegrationBody, UpdateIntegrationBody } from "./schemas";
import { integrationLots, type IntegrationLot as IntegrationLotType } from "./types";

export const IntegrationLot = Schema.Literal(...integrationLots);

export type IntegrationLot = IntegrationLotType;

export const ListedIntegration = Schema.Struct({
	id: Schema.String,
	lot: IntegrationLot,
	provider: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	isDisabled: Schema.Boolean,
	syncOwnership: Schema.Boolean,
	extraSettings: Schema.Unknown,
	minimumProgress: Schema.Number,
	maximumProgress: Schema.Number,
	providerSpecifics: Schema.Unknown,
	name: Schema.optional(Schema.String),
	webhookUrl: Schema.optional(Schema.String),
	lastFinishedAt: Schema.optional(Schema.String),
});

const integrationIdParam = HttpApiSchema.param("integrationId", Schema.String);

export const IntegrationsGroup = HttpApiGroup.make("integrations")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.get("list", "/integrations")
			.setUrlParams(
				Schema.Struct({
					provider: Schema.optional(Schema.String),
					isDisabled: Schema.optional(Schema.BooleanFromString),
				}),
			)
			.addSuccess(Schema.Array(ListedIntegration))
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("create", "/integrations")
			.setPayload(CreateIntegrationBody)
			.addSuccess(Schema.Struct({ id: Schema.String }), { status: 201 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("get")`/integrations/${integrationIdParam}`
			.addSuccess(ListedIntegration)
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.patch("update")`/integrations/${integrationIdParam}`
			.setPayload(UpdateIntegrationBody)
			.addSuccess(ListedIntegration)
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.del("delete")`/integrations/${integrationIdParam}`
			.addSuccess(Schema.Struct({ id: Schema.String }))
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("getRuns")`/integrations/${integrationIdParam}/runs`
			.addSuccess(Schema.Array(ListedImportRun))
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("webhook")`/webhooks/integrations/${integrationIdParam}`
			.addSuccess(Schema.Struct({ runId: Schema.String }), { status: 202 })
			.addError(NotFound, { status: 404 }),
	)
	.addError(NotImplemented, { status: 501 });
