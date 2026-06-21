import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
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
	.add(
		HttpApiEndpoint.get("health", "/system/health")
			.addSuccess(HealthResponse, { status: 200 })
			.addError(HealthCheckFailedError, { status: 503 }),
	)
	.add(HttpApiEndpoint.get("config", "/system/config").addSuccess(ConfigResponse, { status: 200 }));
