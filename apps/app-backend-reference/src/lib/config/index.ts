import { ConfigError, Effect, Option } from "effect";

import { SystemConfigSource, type SystemConfigValue } from "./system";

const validateSystemConfig = (
	config: SystemConfigValue,
): Effect.Effect<SystemConfigValue, ConfigError.ConfigError> => {
	const oidcFields: ReadonlyArray<Option.Option<unknown>> = [
		config.server.oidc.clientId,
		config.server.oidc.issuerUrl,
		config.server.oidc.clientSecret,
	];
	const oidcSetCount = oidcFields.filter(Option.isSome).length;

	if (oidcSetCount > 0 && oidcSetCount < oidcFields.length) {
		return Effect.fail(
			ConfigError.InvalidData(
				[],
				"Partial OIDC configuration detected. Set all three of SERVER_OIDC_CLIENT_ID, SERVER_OIDC_ISSUER_URL, and SERVER_OIDC_CLIENT_SECRET, or none of them.",
			),
		);
	}

	const oidcEnabled = oidcSetCount === oidcFields.length;
	if (config.users.disableLocalAuth && !oidcEnabled) {
		return Effect.fail(
			ConfigError.InvalidData(
				[],
				"USERS_DISABLE_LOCAL_AUTH is set but OIDC credentials are incomplete. Set SERVER_OIDC_CLIENT_ID, SERVER_OIDC_ISSUER_URL, and SERVER_OIDC_CLIENT_SECRET.",
			),
		);
	}

	return Effect.succeed(config);
};

export class AppConfig extends Effect.Service<AppConfig>()("AppConfig", {
	effect: Effect.flatMap(SystemConfigSource, validateSystemConfig),
}) {}

export type AppConfigValue = SystemConfigValue;

export { SystemConfigSource };

export type { SystemConfigValue };
