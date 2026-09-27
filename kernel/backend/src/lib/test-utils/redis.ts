import { Effect, Layer } from "effect";
import Redis from "ioredis";
import { inject } from "vitest";

import { RedisService } from "#lib/infrastructure/redis";

import { makeRedisService } from "./effect";

export const testRedisUrl = () => inject("redisUrl");

export const testExecutionId = (label: string) => `${label}-${crypto.randomUUID()}`;

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
