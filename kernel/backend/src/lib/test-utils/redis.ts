import { Effect, Layer } from "effect";
import Redis from "ioredis";
import { inject } from "vitest";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";

import { makeRedisService } from "./effect";

export const testRedisUrl = () => inject("redisUrl");

export const testExecutionId = (label: string) => `${label}-${crypto.randomUUID()}`;

export const sandboxProtectionKeys = (identity: string) => [
	redisKeys.sandboxCrashWindow(identity),
	redisKeys.sandboxQuarantine(identity),
	redisKeys.sandboxProbation(identity),
	redisKeys.sandboxProbationLease(identity),
];

export const deleteRedisKeysOnExit = (keys: () => ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const redis = yield* RedisService;
		yield* Effect.addFinalizer(() => {
			const pending = keys();
			return pending.length === 0 ? Effect.void : redis.del(...pending);
		});
	});

export const testRedisClient = Effect.acquireRelease(
	Effect.sync(() => new Redis(testRedisUrl())),
	(client) => Effect.promise(() => client.quit()),
);

export const testRedisServiceLayer = Layer.effect(
	RedisService,
	Effect.map(testRedisClient, (client) => makeRedisService({ client })),
);

declare module "vitest" {
	interface ProvidedContext {
		redisUrl: string;
	}
}
