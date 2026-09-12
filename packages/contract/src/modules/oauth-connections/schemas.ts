import { Schema } from "effect";

import { NativeOAuthApplicationId } from "../../oauth";
import { IntegrationId, OAuthConnectionId } from "../../schema/brands";

export const OAUTH_CONNECTION_RETURN_PATH = "/settings/oauth-return";

export const OAuthConnectionClient = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("web") }),
	Schema.Struct({ kind: Schema.Literal("native"), applicationId: NativeOAuthApplicationId }),
]);

export type OAuthConnectionClient = typeof OAuthConnectionClient.Type;

export const OAuthConnectionStatus = Schema.Literals([
	"pending",
	"authorized",
	"connected",
	"failed",
	"expired",
]);

export type OAuthConnectionStatus = typeof OAuthConnectionStatus.Type;

export const CreateOAuthConnectionBody = Schema.Struct({
	field: Schema.String,
	client: OAuthConnectionClient,
	integrationProvider: Schema.String,
	integrationId: Schema.optional(IntegrationId),
});

export type CreateOAuthConnectionBody = typeof CreateOAuthConnectionBody.Type;

export const CreateOAuthConnectionResponse = Schema.Struct({
	authorizeUrl: Schema.String,
	connectionId: OAuthConnectionId,
});

export const CompleteOAuthConnectionBody = Schema.Struct({ secret: Schema.String });

export const OAuthConnectionState = Schema.Struct({ status: OAuthConnectionStatus });

export const OAuthConnectionReturnFragment = Schema.Struct({
	secret: Schema.optional(Schema.String),
	connection: Schema.optional(OAuthConnectionId),
	status: Schema.optional(Schema.Literal("failed")),
});

export type OAuthConnectionReturnFragment = typeof OAuthConnectionReturnFragment.Type;

export const OAuthConnectionCallbackQuery = Schema.Struct({
	iss: Schema.optional(Schema.String),
	code: Schema.optional(Schema.String),
	error: Schema.optional(Schema.String),
	state: Schema.optional(Schema.String),
});

export type OAuthConnectionCallbackQuery = typeof OAuthConnectionCallbackQuery.Type;

const OAuthConnectionRequestFailureReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("oauth-client-not-configured") }),
	Schema.Struct({ code: Schema.Literal("oauth-token-exchange-failed") }),
	Schema.Struct({ code: Schema.Literal("too-many-pending-oauth-connections") }),
	Schema.Struct({ field: Schema.String, code: Schema.Literal("oauth-field-not-found") }),
	Schema.Struct({ provider: Schema.String, code: Schema.Literal("provider-not-found") }),
	Schema.Struct({ integrationId: IntegrationId, code: Schema.Literal("integration-not-found") }),
]);

type OAuthConnectionRequestFailureReason = typeof OAuthConnectionRequestFailureReason.Type;

export class OAuthConnectionRequestError extends Schema.TaggedError<OAuthConnectionRequestError>()(
	"OAuthConnectionRequestError",
	{ reason: OAuthConnectionRequestFailureReason },
) {}

export class OAuthConnectionNotFoundError extends Schema.TaggedError<OAuthConnectionNotFoundError>()(
	"OAuthConnectionNotFoundError",
	{ reason: Schema.Struct({ code: Schema.Literal("oauth-connection-not-found") }) },
) {}
