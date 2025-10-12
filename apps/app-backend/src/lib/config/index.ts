import { appConfigDef, systemConfigDef } from "./definition";
import { getMaskedConfig } from "./masker";
import { buildPathIndex, parseGroupDef } from "./parser";
import type { ExtractEnvKeys, ExtractPaths } from "./types";

const { config: rawSystem, envIndex: systemConfigEnvIndex } = parseGroupDef(
	systemConfigDef,
	process.env,
);

const { config: rawApp, envIndex: rawAppEnvIndex } = parseGroupDef(appConfigDef, process.env);

function requireField(value: string | undefined, envKey: string): string {
	if (value === undefined) {
		throw new Error(`Required config key "${envKey}" is not set`);
	}
	return value;
}

const parsedPort = Number.parseInt(
	rawSystem.port ?? systemConfigDef.children.port.default ?? "",
	10,
);
if (Number.isNaN(parsedPort)) {
	throw new Error(`PORT must be a valid integer, got "${rawSystem.port}"`);
}

export const config = {
	port: parsedPort,
	fileStorage: rawSystem.fileStorage,
	nodeEnv: rawSystem.nodeEnv ?? "production",
	frontend: { oidcButtonLabel: rawSystem.frontend.oidcButtonLabel },
	importer: { trakt: { clientId: rawSystem.importer.trakt.clientId } },
	redisUrl: requireField(rawSystem.redisUrl, "REDIS_URL"),
	databaseUrl: requireField(rawSystem.databaseUrl, "DATABASE_URL"),
	frontendUrl: requireField(rawSystem.frontendUrl, "FRONTEND_URL"),
	timezone: rawSystem.timezone ?? systemConfigDef.children.timezone.default ?? "Etc/GMT",
	users: {
		disableLocalAuth: rawSystem.users.disableLocalAuth === "true",
		allowRegistration: rawSystem.users.allowRegistration === "true",
	},
	server: {
		adminAccessToken: requireField(rawSystem.server.adminAccessToken, "SERVER_ADMIN_ACCESS_TOKEN"),
		corsOrigins:
			rawSystem.server.corsOrigins
				?.split(",")
				.map((origin) => origin.trim())
				.filter(Boolean) ?? [],
		oidc: {
			clientId: rawSystem.server.oidc.clientId,
			issuerUrl: rawSystem.server.oidc.issuerUrl,
			clientSecret: rawSystem.server.oidc.clientSecret,
			enabled: !!(
				rawSystem.server.oidc.clientId &&
				rawSystem.server.oidc.issuerUrl &&
				rawSystem.server.oidc.clientSecret
			),
		},
	},
};

export const IS_DEVELOPMENT = config.nodeEnv === "development";

const oidcFields = [
	config.server.oidc.clientId,
	config.server.oidc.issuerUrl,
	config.server.oidc.clientSecret,
];
const oidcSetCount = oidcFields.filter(Boolean).length;
if (oidcSetCount > 0 && oidcSetCount < 3) {
	throw new Error(
		"Partial OIDC configuration detected. " +
			"Set all three of SERVER_OIDC_CLIENT_ID, SERVER_OIDC_ISSUER_URL, and SERVER_OIDC_CLIENT_SECRET, or none of them.",
	);
}

if (config.users.disableLocalAuth && !config.server.oidc.enabled) {
	throw new Error(
		"USERS_DISABLE_LOCAL_AUTH is set but OIDC credentials are incomplete. " +
			"Set SERVER_OIDC_CLIENT_ID, SERVER_OIDC_ISSUER_URL, and SERVER_OIDC_CLIENT_SECRET.",
	);
}

export const appConfig = rawApp;
export type AppConfig = typeof rawApp;

export type AppConfigEnvKey = ExtractEnvKeys<typeof appConfigDef.children>;

// oxlint-disable-next-line no-unsafe-type-assertion
export const appConfigEnvIndex = rawAppEnvIndex as Record<AppConfigEnvKey, string | undefined>;

export type AppConfigPath = ExtractPaths<typeof appConfigDef.children>;

// oxlint-disable-next-line no-unsafe-type-assertion
export const appConfigPathIndex = buildPathIndex(appConfigDef) as Record<
	AppConfigPath,
	AppConfigEnvKey
>;

export { appConfigDef, systemConfigDef } from "./definition";
export { getMaskedConfig, systemConfigEnvIndex };
