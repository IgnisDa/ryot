import { assert } from "@ryot-app/testing/assert";
import { Effect, Layer } from "effect";
import Redis from "ioredis";

import { RedisService } from "#platform/redis";

import { makeRedisService } from "./effect";

export const testRedisUrl = () => {
	const url = Bun.env["TEST_REDIS_URL"];
	assert(url, "Run Redis tests through the package test script");
	return url;
};

export const testExecutionId = (label: string) => `${label}-${crypto.randomUUID()}`;

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
