import { Context, Effect, Layer, Redacted } from "effect";
import Redis from "ioredis";

import { AppConfig } from "./config/service";

export const redisKeys = {
	entityUpdatedChannel: "ryot:entity:updated",
	pluginRegistryChannel: "ryot:plugins:registry",
	uploadIntentExpiry: "ryot:upload:intents:expiry",
	uploadToken: (token: string) => `ryot:upload:token:${token}`,
	uploadIntent: (intentId: string) => `ryot:upload:intent:${intentId}`,
	godModePendingReset: (email: string) => `ryot:god-mode:pending:${email}`,
	uploadIntentLock: (intentId: string) => `ryot:upload:intent-lock:${intentId}`,
	importSourcePayload: (runId: string) => `ryot:imports:source-payload:${runId}`,
	importAdapterResult: (runId: string) => `ryot:imports:adapter-result:${runId}`,
	godModeResetChannel: (correlationId: string) => `ryot:god-mode:reset:${correlationId}`,
	uploadIntentCleanupLock: (intentId: string) => `ryot:upload:intent-cleanup-lock:${intentId}`,
	sandboxWorkflowJournal: (executionId: string) => `ryot:sandbox:workflow:${executionId}:journal`,
	integrationCache: (integrationId: string, key: string) =>
		`ryot:integrations:cache:${integrationId}:${key}`,
	sandboxCache: (userId: string | null, scriptId: string, key: string) =>
		`ryot:sandbox:cache:${userId === null ? "kernel" : `user:${userId}`}:${scriptId}:${key}`,
	sandboxRunCache: (serverRunId: string, userId: string | null, scriptId: string, key: string) =>
		`ryot:sandbox:cache:run:${serverRunId}:${userId === null ? "kernel" : `user:${userId}`}:${scriptId}:${key}`,
};

export class RedisService extends Context.Service<RedisService>()("RedisService", {
	make: Effect.gen(function* () {
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
			del: (...keys: ReadonlyArray<string>) =>
				Effect.tryPromise(() => client.del(...keys)).pipe(Effect.orDie),
			publish: (channel: string, message: string) =>
				Effect.tryPromise(() => client.publish(channel, message)).pipe(Effect.orDie),
			set: (key: string, value: string, ttlSeconds?: number) =>
				Effect.tryPromise(() =>
					ttlSeconds ? client.set(key, value, "EX", ttlSeconds) : client.set(key, value),
				).pipe(Effect.asVoid, Effect.orDie),
			acquireLease: (key: string, ttlSeconds: number) =>
				Effect.gen(function* () {
					const owner = crypto.randomUUID();
					const result = yield* Effect.tryPromise(() =>
						client.set(key, owner, "EX", ttlSeconds, "NX"),
					);
					return result === null ? null : owner;
				}).pipe(Effect.orDie),
			releaseLease: (key: string, owner: string) =>
				Effect.tryPromise(() =>
					client.eval(
						"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
						1,
						key,
						owner,
					),
				).pipe(Effect.asVoid, Effect.orDie),
			renewLease: (key: string, owner: string, ttlSeconds: number) =>
				Effect.tryPromise(() =>
					client.eval(
						"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
						1,
						key,
						owner,
						String(ttlSeconds),
					),
				).pipe(
					Effect.map((result) => result === 1),
					Effect.orDie,
				),
			zrem: (key: string, ...members: ReadonlyArray<string>) =>
				Effect.tryPromise(() => client.zrem(key, ...members)).pipe(Effect.asVoid, Effect.orDie),
			zrangeByScore: (key: string, max: number, limit: number) =>
				Effect.tryPromise(() => client.zrangebyscore(key, 0, max, "LIMIT", 0, limit)).pipe(
					Effect.orDie,
				),
			setAndIndex: (key: string, value: string, indexKey: string, score: number, member: string) =>
				Effect.tryPromise(() =>
					client.multi().set(key, value).zadd(indexKey, score, member).exec(),
				).pipe(Effect.asVoid, Effect.orDie),
			setAndRemoveFromIndex: (key: string, value: string, indexKey: string, member: string) =>
				Effect.tryPromise(() => client.multi().set(key, value).zrem(indexKey, member).exec()).pipe(
					Effect.asVoid,
					Effect.orDie,
				),
			setAndIndexAndDelete: (
				key: string,
				value: string,
				indexKey: string,
				score: number,
				member: string,
				deleteKey: string,
			) =>
				Effect.tryPromise(() =>
					client.multi().set(key, value).zadd(indexKey, score, member).del(deleteKey).exec(),
				).pipe(Effect.asVoid, Effect.orDie),
			setAndIndexAndSet: (
				key: string,
				value: string,
				indexKey: string,
				score: number,
				member: string,
				secondaryKey: string,
				secondaryValue: string,
				secondaryTtlSeconds: number,
			) =>
				Effect.tryPromise(() =>
					client
						.multi()
						.set(key, value)
						.zadd(indexKey, score, member)
						.set(secondaryKey, secondaryValue, "EX", secondaryTtlSeconds)
						.exec(),
				).pipe(Effect.asVoid, Effect.orDie),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
