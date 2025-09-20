import { ConfigError, Context, Effect, Layer, Option, Redacted } from "effect";

import { SystemConfigSource, type SystemConfigValue } from "./system";

const isNonEmpty = (opt: Option.Option<string>) => Option.isSome(opt) && opt.value.length > 0;

const isNonEmptyRedacted = (opt: Option.Option<Redacted.Redacted>) =>
	Option.isSome(opt) && Redacted.value(opt.value).length > 0;

export const isOidcEnabled = (config: SystemConfigValue): boolean => {
	const { clientId, clientSecret, issuerUrl } = config.server.oidc;
	return isNonEmpty(clientId) && isNonEmpty(issuerUrl) && isNonEmptyRedacted(clientSecret);
};

const validateSystemConfig = (
	config: SystemConfigValue,
): Effect.Effect<SystemConfigValue, ConfigError.ConfigError> => {
	const { clientId, clientSecret, issuerUrl } = config.server.oidc;
	const oidcSetCount = [
		isNonEmpty(clientId),
		isNonEmpty(issuerUrl),
		isNonEmptyRedacted(clientSecret),
	].filter(Boolean).length;

	if (oidcSetCount > 0 && oidcSetCount < 3) {
		return Effect.fail(
			ConfigError.InvalidData(
				[],
				"Partial OIDC configuration detected. Set all three of SERVER_OIDC_CLIENT_ID, SERVER_OIDC_ISSUER_URL, and SERVER_OIDC_CLIENT_SECRET, or none of them.",
			),
		);
	}

	const oidcEnabled = oidcSetCount === 3;
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

export class AppConfig extends Context.Tag("AppConfig")<AppConfig, SystemConfigValue>() {}

export const AppConfigLive = Layer.effect(
	AppConfig,
	Effect.flatMap(SystemConfigSource, validateSystemConfig),
);

export type AppConfigValue = SystemConfigValue;

export { SystemConfigSource };

export type { SystemConfigValue };
