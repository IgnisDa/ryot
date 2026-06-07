import { HttpApiBuilder } from "@effect/platform";
import { sql } from "drizzle-orm";
import { Effect, Option } from "effect";

import { AppConfig, isOidcEnabled } from "#lib/config";
import { AppContract } from "#lib/contract";
import { DbService } from "#lib/db";
import { healthCheckFailed, unknownToMessage } from "#lib/errors";
import { RedisService } from "#lib/redis";

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
