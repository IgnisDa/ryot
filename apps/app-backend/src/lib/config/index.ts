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
	redisUrl: requireField(rawSystem.redisUrl, "REDIS_URL"),
	users: { allowRegistration: rawSystem.users.allowRegistration === "true" },
	databaseUrl: requireField(rawSystem.databaseUrl, "DATABASE_URL"),
	frontendUrl: requireField(rawSystem.frontendUrl, "FRONTEND_URL"),
	server: {
		adminAccessToken: requireField(rawSystem.server.adminAccessToken, "SERVER_ADMIN_ACCESS_TOKEN"),
	},
};

export const IS_DEVELOPMENT = config.nodeEnv === "development";

export const appConfig = rawApp;
export type AppConfig = typeof rawApp;

export type AppConfigEnvKey = ExtractEnvKeys<typeof appConfigDef.children>;

export const appConfigEnvIndex = rawAppEnvIndex as Record<AppConfigEnvKey, string | undefined>;

export type AppConfigPath = ExtractPaths<typeof appConfigDef.children>;

export const appConfigPathIndex = buildPathIndex(appConfigDef) as Record<
	AppConfigPath,
	AppConfigEnvKey
>;

export { appConfigDef, systemConfigDef } from "./definition";
export { getMaskedConfig, systemConfigEnvIndex };
