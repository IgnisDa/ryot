import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Clock, Context, DateTime, Effect, Layer } from "effect";

import { RedisService } from "./redis";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class ReusableCapabilityGrantStore extends Context.Service<ReusableCapabilityGrantStore>()(
	"ReusableCapabilityGrantStore",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const resolve = (token: string, grantKey: (id: string) => string) =>
				TOKEN_PATTERN.test(token) &&
				Buffer.from(token, "base64url").length === 32 &&
				Buffer.from(token, "base64url").toString("base64url") === token
					? redis.get(grantKey(sha256Hex(token)))
					: Effect.succeed(null);
			return {
				resolve,
				issue: Effect.fn("ReusableCapabilityGrantStore.issue")(function* (input: {
					readonly payload: string;
					readonly reuseKey: string;
					readonly ttlSeconds: number;
					readonly grantKey: (id: string) => string;
				}) {
					for (let attempt = 0; attempt < 4; attempt++) {
						let token = yield* redis.get(input.reuseKey);
						if (token && (yield* resolve(token, input.grantKey)) !== input.payload) {
							yield* redis.releaseLease(input.reuseKey, token);
							token = null;
						}
						if (!token) {
							const fresh = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
								"base64url",
							);
							yield* redis.set(input.grantKey(sha256Hex(fresh)), input.payload, input.ttlSeconds);
							const stored = yield* Effect.tryPromise(() =>
								redis.client.set(input.reuseKey, fresh, "EX", input.ttlSeconds, "NX"),
							).pipe(Effect.orDie);
							token = stored ? fresh : yield* redis.get(input.reuseKey);
						}
						if (!token) {
							continue;
						}
						const grantId = sha256Hex(token);
						const ttl = yield* Effect.tryPromise(() =>
							redis.client.ttl(input.grantKey(grantId)),
						).pipe(Effect.orDie);
						if (ttl <= 0) {
							yield* redis.releaseLease(input.reuseKey, token);
							continue;
						}
						const now = yield* Clock.currentTimeMillis;
						return {
							token,
							grantId,
							expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + ttl * 1000)),
						};
					}
					return yield* Effect.die(new Error("Unable to issue reusable capability grant"));
				}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
