import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { NotFound, NotImplemented, Unauthorized } from "../../lib/errors";
import { ListedImportRun } from "../imports/contract";

export const ListedIntegration = Schema.Struct({
	id: Schema.String,
	lot: Schema.Literal("yank", "sink", "push"),
	provider: Schema.String,
	isDisabled: Schema.Boolean,
	syncOwnership: Schema.Boolean,
	minimumProgress: Schema.Number,
	maximumProgress: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	extraSettings: Schema.Unknown,
	providerSpecifics: Schema.Unknown,
	name: Schema.optional(Schema.String),
	webhookUrl: Schema.optional(Schema.String),
	lastFinishedAt: Schema.optional(Schema.String),
});

const CreateIntegrationBody = Schema.Struct({
	provider: Schema.String,
	providerSpecifics: Schema.Unknown,
	name: Schema.optional(Schema.String),
	isDisabled: Schema.optional(Schema.Boolean),
	syncOwnership: Schema.optional(Schema.Boolean),
	extraSettings: Schema.optional(Schema.Unknown),
	minimumProgress: Schema.optional(Schema.Number),
	maximumProgress: Schema.optional(Schema.Number),
});

const UpdateIntegrationBody = Schema.Struct({
	name: Schema.optional(Schema.String),
	isDisabled: Schema.optional(Schema.Boolean),
	syncOwnership: Schema.optional(Schema.Boolean),
	extraSettings: Schema.optional(Schema.Unknown),
	minimumProgress: Schema.optional(Schema.Number),
	maximumProgress: Schema.optional(Schema.Number),
	providerSpecifics: Schema.optional(Schema.Unknown),
});

const integrationIdParam = HttpApiSchema.param("integrationId", Schema.String);

export const IntegrationsGroup = HttpApiGroup.make("integrations")
	.add(
		HttpApiEndpoint.get("list", "/integrations")
			.setUrlParams(
				Schema.Struct({
					provider: Schema.optional(Schema.String),
					isDisabled: Schema.optional(Schema.BooleanFromString),
				}),
			)
			.addSuccess(Schema.Array(ListedIntegration))
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("create", "/integrations")
			.setPayload(CreateIntegrationBody)
			.addSuccess(Schema.Struct({ id: Schema.String }), { status: 201 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("get")`/integrations/${integrationIdParam}`
			.addSuccess(ListedIntegration)
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.patch("update")`/integrations/${integrationIdParam}`
			.setPayload(UpdateIntegrationBody)
			.addSuccess(ListedIntegration)
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.del("delete")`/integrations/${integrationIdParam}`
			.addSuccess(Schema.Struct({ id: Schema.String }))
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("getRuns")`/integrations/${integrationIdParam}/runs`
			.addSuccess(Schema.Array(ListedImportRun))
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("webhook")`/webhooks/integrations/${integrationIdParam}`
			.addSuccess(Schema.Struct({ runId: Schema.String }), { status: 202 })
			.addError(NotFound, { status: 404 }),
	)
	.addError(NotImplemented, { status: 501 });
