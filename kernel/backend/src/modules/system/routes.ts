import { AppContract } from "@ryot-app/contract/contract";
import {
	type SystemConfigResponse,
	SystemHealthFailure,
} from "@ryot-app/contract/modules/system/contract";
import { sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { ObjectStorageService } from "#modules/assets/storage/object-storage";
import { RYOT_VERSION } from "#platform/build-info";
import { AppConfig, type AppConfigValue } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";
import { ProKeyService } from "#platform/pro-key";
import { RedisService } from "#platform/redis";

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

export const publicSystemConfig = (
	config: AppConfigValue,
	isServerKeyValidated: boolean,
	permanentUploadProvider: "local" | "s3",
) =>
	({
		version: RYOT_VERSION,
		pro: { isServerKeyValidated },
		frontendOrigin: config.frontendUrl,
		analytics: { umami: umamiAnalytics(config) },
		notifications: { smtpEnabled: Option.isSome(config.server.smtp) },
		fileStorage: {
			temporaryUploadProvider: "local",
			preferredPermanentUploadProvider: permanentUploadProvider,
		},
		auth: {
			oidcEnabled: Option.isSome(config.server.oidc),
			localAuthDisabled: config.users.disableLocalAuth,
			signupAllowed: config.users.allowRegistration && !config.users.disableLocalAuth,
			oidcButtonLabel: Option.getOrUndefined(nonEmpty(config.frontend.oidcButtonLabel)),
		},
	}) satisfies SystemConfigResponse;

export const SystemRoutesLive = HttpApiBuilder.group(AppContract, "system", (handlers) =>
	handlers
		.handle("health", () =>
			Effect.gen(function* () {
				const database = yield* DatabaseSession;
				const redis = yield* RedisService;

				yield* database
					.run((db) => db.execute(sql`select 1`))
					.pipe(
						Effect.tapError((cause) =>
							Effect.logError("system health database check failed", cause),
						),
						Effect.mapError(
							() => new SystemHealthFailure({ reason: { code: "database-unavailable" } }),
						),
					);

				yield* Effect.tryPromise({
					catch: (cause) => ({ cause }),
					try: () => redis.client.ping(),
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
				const objectStorage = yield* ObjectStorageService;
				const isServerKeyValidated = yield* proKey.isValidated;
				return publicSystemConfig(
					config,
					isServerKeyValidated,
					yield* objectStorage.permanentStorageProvider,
				);
			}),
		),
);
