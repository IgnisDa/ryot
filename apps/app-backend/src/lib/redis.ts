import { Context, Effect, Layer, Redacted } from "effect";
import Redis from "ioredis";

import { AppConfig } from "./config";

export const redisKeys = {
	sandboxSession: (executionId: string) => `ryot:sandbox:session:${executionId}`,
};

export class RedisService extends Context.Tag("RedisService")<
	RedisService,
	{
		readonly client: Redis;
		readonly get: (key: string) => Effect.Effect<string | null>;
		readonly del: (...keys: ReadonlyArray<string>) => Effect.Effect<number>;
		readonly publish: (channel: string, message: string) => Effect.Effect<number>;
		readonly set: (key: string, value: string, ttlSeconds?: number) => Effect.Effect<void>;
	}
>() {}

export const RedisLive = Layer.scoped(
	RedisService,
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const client = new Redis(Redacted.value(config.redisUrl), {
			lazyConnect: true,
			maxRetriesPerRequest: 3,
		});
		yield* Effect.tryPromise(() => client.connect()).pipe(Effect.orDie);
		yield* Effect.addFinalizer(() => Effect.promise(() => client.quit()).pipe(Effect.orDie));

		return {
			client,
			get: (key) => Effect.tryPromise(() => client.get(key)).pipe(Effect.orDie),
			del: (...keys) => Effect.tryPromise(() => client.del(...keys)).pipe(Effect.orDie),
			publish: (channel, message) =>
				Effect.tryPromise(() => client.publish(channel, message)).pipe(Effect.orDie),
			set: (key, value, ttlSeconds) =>
				Effect.tryPromise(() =>
					ttlSeconds ? client.set(key, value, "EX", ttlSeconds) : client.set(key, value),
				).pipe(Effect.asVoid, Effect.orDie),
		};
	}),
);
