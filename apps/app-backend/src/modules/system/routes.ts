import { AppContract } from "@ryot/contract/contract";
import { healthCheckFailed, unknownToMessage } from "@ryot/contract/errors";
import { sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { AppConfig, isOidcEnabled, isSmtpEnabled } from "#lib/infrastructure/config/service";
import { DbService } from "#lib/infrastructure/db/service";
import { RedisService } from "#lib/infrastructure/redis";

export const SystemRoutesLive = HttpApiBuilder.group(AppContract, "system", (handlers) =>
	handlers
		.handle("health", () =>
			Effect.gen(function* () {
				const { db } = yield* DbService;
				const redis = yield* RedisService;

				yield* Effect.tryPromise({
					try: () => db.execute(sql`select 1`),
					catch: (cause) => healthCheckFailed(`Database check failed: ${unknownToMessage(cause)}`),
				});

				yield* Effect.tryPromise({
					try: () => redis.client.ping(),
					catch: (cause) => healthCheckFailed(`Redis check failed: ${unknownToMessage(cause)}`),
				});

				return { status: "healthy" as const };
			}),
		)
		.handle("config", () =>
			Effect.gen(function* () {
				const config = yield* AppConfig;
				return {
					notifications: { smtpEnabled: isSmtpEnabled(config) },
					auth: {
						oidcEnabled: isOidcEnabled(config),
						localAuthDisabled: config.users.disableLocalAuth,
						signupAllowed: config.users.allowRegistration && !config.users.disableLocalAuth,
						oidcButtonLabel: Option.getOrUndefined(
							Option.filter(config.frontend.oidcButtonLabel, (label) => label.length > 0),
						),
					},
				};
			}),
		),
);
