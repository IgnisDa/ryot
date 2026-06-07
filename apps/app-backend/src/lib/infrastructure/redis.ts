import { Effect, Redacted } from "effect";
import Redis from "ioredis";

import { AppConfig } from "./config/service";

export const redisKeys = {
	entityUpdatedChannel: "ryot:entity:updated",
	uploadToken: (token: string) => `ryot:upload:token:${token}`,
	betterAuthApiKeyById: (id: string) => `better-auth:api-key:by-id:${id}`,
	godModePendingReset: (email: string) => `ryot:god-mode:pending:${email}`,
	sandboxSession: (executionId: string) => `ryot:sandbox:session:${executionId}`,
	importSourcePayload: (runId: string) => `ryot:imports:source-payload:${runId}`,
	betterAuthApiKeyByHash: (hashedKey: string) => `better-auth:api-key:${hashedKey}`,
	godModeResetChannel: (correlationId: string) => `ryot:god-mode:reset:${correlationId}`,
	sandboxCache: (scriptId: string, key: string) => `ryot:sandbox:cache:${scriptId}:${key}`,
	betterAuthApiKeyByReference: (referenceId: string) => `better-auth:api-key:by-ref:${referenceId}`,
	integrationCache: (integrationId: string, key: string) =>
		`ryot:integrations:cache:${integrationId}:${key}`,
};

export class RedisService extends Effect.Service<RedisService>()("RedisService", {
	scoped: Effect.gen(function* () {
		const config = yield* AppConfig;
		const client = new Redis(Redacted.value(config.redisUrl), {
			lazyConnect: true,
			maxRetriesPerRequest: 3,
		});
		yield* Effect.tryPromise(() => client.connect()).pipe(Effect.orDie);
		yield* Effect.addFinalizer(() => Effect.promise(() => client.quit()).pipe(Effect.orDie));

		return {
			client,
			get: (key: string) => Effect.tryPromise(() => client.get(key)).pipe(Effect.orDie),
			getdel: (key: string) => Effect.tryPromise(() => client.getdel(key)).pipe(Effect.orDie),
			del: (...keys: ReadonlyArray<string>) =>
				Effect.tryPromise(() => client.del(...keys)).pipe(Effect.orDie),
			publish: (channel: string, message: string) =>
				Effect.tryPromise(() => client.publish(channel, message)).pipe(Effect.orDie),
			set: (key: string, value: string, ttlSeconds?: number) =>
				Effect.tryPromise(() =>
					ttlSeconds ? client.set(key, value, "EX", ttlSeconds) : client.set(key, value),
				).pipe(Effect.asVoid, Effect.orDie),
			claim: (key: string, ttlSeconds: number) =>
				Effect.tryPromise(() => client.set(key, "1", "EX", ttlSeconds, "NX")).pipe(
					Effect.map((result) => result !== null),
					Effect.orDie,
				),
		};
	}),
}) {}
