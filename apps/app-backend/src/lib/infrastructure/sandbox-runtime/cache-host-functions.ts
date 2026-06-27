import { unknownToMessage } from "@ryot/contract/errors";
import { Effect, Runtime, Schema } from "effect";

import { RedisService, redisKeys } from "../redis";
import {
	apiFailure,
	type BoundHostFunction,
	requireSandboxRunInput,
	runHostEffect,
} from "./shared";

export const makeCacheSandboxApiFunctions = (): Effect.Effect<
	Record<string, BoundHostFunction>,
	never,
	RedisService
> =>
	Effect.gen(function* () {
		const redis = yield* RedisService;
		const runtime = yield* Effect.runtime();
		const runPromise = Runtime.runPromise(runtime);

		return {
			claimCachedValue: (...args) => {
				const key = args[0];
				const value = args[1];
				const ttlSeconds = args[2];
				const input = requireSandboxRunInput(args, 3, "claimCachedValue");
				if (typeof key !== "string" || !key.trim()) {
					return Promise.resolve(apiFailure("claimCachedValue expects a non-empty key string"));
				}
				if (typeof ttlSeconds !== "number" || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
					return Promise.resolve(
						apiFailure("claimCachedValue expects a positive integer ttlSeconds"),
					);
				}

				const redisKey = redisKeys.sandboxCache(input.scriptId, key.trim());

				return runHostEffect(
					runPromise,
					Effect.gen(function* () {
						const serialized = yield* Schema.encode(Schema.parseJson(Schema.Unknown))(value).pipe(
							Effect.mapError(() => "claimCachedValue value must be JSON-serializable"),
						);

						const setResult = yield* Effect.tryPromise({
							try: () => redis.client.set(redisKey, serialized, "EX", ttlSeconds, "NX"),
							catch: unknownToMessage,
						});
						if (setResult !== null) {
							return { claimed: true };
						}

						const existing = yield* Effect.tryPromise({
							try: () => redis.client.get(redisKey),
							catch: unknownToMessage,
						});
						if (existing === null) {
							return { claimed: false, value: null };
						}

						return yield* Schema.decode(Schema.parseJson(Schema.Unknown))(existing).pipe(
							Effect.map((decoded) => ({ claimed: false as const, value: decoded })),
							Effect.orElseSucceed(() => ({ claimed: false as const, value: null })),
						);
					}),
				);
			},
		};
	});
