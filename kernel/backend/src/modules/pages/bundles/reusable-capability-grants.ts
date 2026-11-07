import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Clock, Context, DateTime, Duration, Effect, Layer } from "effect";

import { TransientValues } from "#platform/transient-values";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class ReusableCapabilityGrantStore extends Context.Service<ReusableCapabilityGrantStore>()(
	"@ryot-app/kernel-backend/modules/pages/bundles/reusable-capability-grants/ReusableCapabilityGrantStore",
	{
		make: Effect.gen(function* () {
			const values = yield* TransientValues;
			const resolve = (token: string, grantKey: (id: string) => string) =>
				TOKEN_PATTERN.test(token) &&
				Buffer.from(token, "base64url").length === 32 &&
				Buffer.from(token, "base64url").toString("base64url") === token
					? values.get(grantKey(sha256Hex(token))).pipe(Effect.orDie)
					: Effect.succeed(null);
			return {
				resolve,
				issue: Effect.fn("ReusableCapabilityGrantStore.issue")(function* (input: {
					readonly payload: string;
					readonly reuseKey: string;
					readonly ttlSeconds: number;
					readonly grantKey: (id: string) => string;
				}) {
					const ttl = Duration.seconds(input.ttlSeconds);
					for (let attempt = 0; attempt < 4; attempt++) {
						let token = yield* values.get(input.reuseKey);
						if (token && (yield* resolve(token, input.grantKey)) !== input.payload) {
							yield* values.removeIfEquals(input.reuseKey, token);
							token = null;
						}
						if (!token) {
							const fresh = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
								"base64url",
							);
							yield* values.set(input.grantKey(sha256Hex(fresh)), input.payload, ttl);
							const stored = yield* values.setIfAbsent(input.reuseKey, fresh, ttl);
							token = stored ? fresh : yield* values.get(input.reuseKey);
						}
						if (!token) {
							continue;
						}
						const grantId = sha256Hex(token);
						const remaining = yield* values.remainingMillis(input.grantKey(grantId));
						if (remaining === null || remaining <= 0) {
							yield* values.removeIfEquals(input.reuseKey, token);
							continue;
						}
						const now = yield* Clock.currentTimeMillis;
						return {
							token,
							grantId,
							expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + remaining)),
						};
					}
					return yield* Effect.die(new Error("Unable to issue reusable capability grant"));
				}, Effect.orDie),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const ReusableCapabilityGrantStoreLive = ReusableCapabilityGrantStore.layer.pipe(
	Layer.provide(TransientValues.layer),
);
