import { AppContract } from "@ryot/contract/contract";
import {
	SystemHealthFailure,
	type SystemConfigResponse,
} from "@ryot/contract/modules/system/contract";
import { sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import {
	AppConfig,
	type AppConfigValue,
	isOidcEnabled,
	isS3Configured,
	isSmtpEnabled,
} from "#lib/infrastructure/config/service";
import { Database } from "#lib/infrastructure/db/service";
import { ProKeyService } from "#lib/infrastructure/pro-key";
import { RedisService } from "#lib/infrastructure/redis";

const nonEmpty = (value: Option.Option<string>) =>
	Option.filter(value, (candidate) => candidate.length > 0);

const umamiAnalytics = (config: AppConfigValue) => {
	if (config.disableTelemetry) {
		return undefined;
	}
	const hostUrl = nonEmpty(config.frontend.umami.hostUrl);
	const websiteId = nonEmpty(config.frontend.umami.websiteId);
	if (Option.isNone(hostUrl) || Option.isNone(websiteId)) {
		return undefined;
	}
	return { hostUrl: hostUrl.value, websiteId: websiteId.value };
};

export const publicSystemConfig = (config: AppConfigValue, isServerKeyValidated: boolean) =>
	({
		pro: { isServerKeyValidated },
		frontendOrigin: config.frontendUrl,
		analytics: { umami: umamiAnalytics(config) },
		notifications: { smtpEnabled: isSmtpEnabled(config) },
		fileStorage: {
			temporaryUploadProvider: "local",
			preferredPermanentUploadProvider: isS3Configured(config) ? "s3" : "local",
		},
		auth: {
			oidcEnabled: isOidcEnabled(config),
			localAuthDisabled: config.users.disableLocalAuth,
			signupAllowed: config.users.allowRegistration && !config.users.disableLocalAuth,
			oidcButtonLabel: Option.getOrUndefined(nonEmpty(config.frontend.oidcButtonLabel)),
		},
	}) satisfies SystemConfigResponse;

export const SystemRoutesLive = HttpApiBuilder.group(AppContract, "system", (handlers) =>
	handlers
		.handle("health", () =>
			Effect.gen(function* () {
				const database = yield* Database;
				const redis = yield* RedisService;

				yield* database.execute(sql`select 1`).pipe(
					Effect.tapError((cause) => Effect.logError("system health database check failed", cause)),
					Effect.mapError(
						() => new SystemHealthFailure({ reason: { code: "database-unavailable" } }),
					),
				);

				yield* Effect.tryPromise({
					try: () => redis.client.ping(),
					catch: (cause) => ({ cause }),
				}).pipe(
					Effect.tapError(({ cause }) =>
						Effect.logError("system health Redis check failed", cause),
					),
					Effect.mapError(() => new SystemHealthFailure({ reason: { code: "redis-unavailable" } })),
				);

				return { status: "healthy" as const };
			}),
		)
		.handle("config", () =>
			Effect.gen(function* () {
				const config = yield* AppConfig;
				const proKey = yield* ProKeyService;
				const isServerKeyValidated = yield* proKey.isValidated;
				return publicSystemConfig(config, isServerKeyValidated);
			}),
		),
);
