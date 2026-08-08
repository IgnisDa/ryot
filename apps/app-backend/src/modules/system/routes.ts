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
import { RedisService } from "#lib/infrastructure/redis";

export const publicSystemConfig = (config: AppConfigValue) =>
	({
		notifications: { smtpEnabled: isSmtpEnabled(config) },
		fileStorage: {
			temporaryUploadProvider: "local",
			preferredPermanentUploadProvider: isS3Configured(config) ? "s3" : "local",
		},
		auth: {
			oidcEnabled: isOidcEnabled(config),
			localAuthDisabled: config.users.disableLocalAuth,
			signupAllowed: config.users.allowRegistration && !config.users.disableLocalAuth,
			oidcButtonLabel: Option.getOrUndefined(
				Option.filter(config.frontend.oidcButtonLabel, (label) => label.length > 0),
			),
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
				return publicSystemConfig(config);
			}),
		),
);
