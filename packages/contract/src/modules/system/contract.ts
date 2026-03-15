import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { BadRequest, HealthCheckFailedError } from "../../errors";

const HealthResponse = Schema.Struct({ status: Schema.Literal("healthy") });

const AuthConfig = Schema.Struct({
	oidcEnabled: Schema.Boolean,
	signupAllowed: Schema.Boolean,
	localAuthDisabled: Schema.Boolean,
	oidcButtonLabel: Schema.optional(Schema.String),
});

const NotificationConfig = Schema.Struct({ smtpEnabled: Schema.Boolean });

const ConfigResponse = Schema.Struct({ auth: AuthConfig, notifications: NotificationConfig });

export const SystemGroup = HttpApiGroup.make("system")
	.annotate(OpenApi.Description, "Provides system health and public configuration.")
	.add(
		HttpApiEndpoint.get("health", "/system/health", {
			success: HealthResponse.pipe(HttpApiSchema.status(200)),
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				HealthCheckFailedError.pipe(HttpApiSchema.status(503)),
			],
		}).annotate(OpenApi.Description, "Checks whether the system is healthy."),
	)
	.add(
		HttpApiEndpoint.get("config", "/system/config", {
			success: ConfigResponse.pipe(HttpApiSchema.status(200)),
			error: BadRequest.pipe(HttpApiSchema.status(400)),
		}).annotate(OpenApi.Description, "Returns the public system configuration."),
	);
