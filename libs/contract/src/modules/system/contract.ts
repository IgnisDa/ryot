import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { HealthCheckFailedError } from "../../errors";

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
		HttpApiEndpoint.get("health", "/system/health")
			.annotate(OpenApi.Description, "Checks whether the system is healthy.")
			.addSuccess(HealthResponse, { status: 200 })
			.addError(HealthCheckFailedError, { status: 503 }),
	)
	.add(
		HttpApiEndpoint.get("config", "/system/config")
			.annotate(OpenApi.Description, "Returns the public system configuration.")
			.addSuccess(ConfigResponse, { status: 200 }),
	);
