import { Effect, Redacted, Schema } from "effect";
import Redis from "ioredis";

import { AppConfig } from "./config/service";
import { EntityId } from "./schema/brands";

export const redisKeys = {
	// Channel a workflow publishes to on populate/translate completion; the WS registry fans it out.
	entityUpdatedChannel: "ryot:entity:updated",
	uploadToken: (token: string) => `ryot:upload:token:${token}`,
	godModePendingReset: (email: string) => `ryot:god-mode:pending:${email}`,
	sandboxSession: (executionId: string) => `ryot:sandbox:session:${executionId}`,
	importSourcePayload: (runId: string) => `ryot:imports:source-payload:${runId}`,
	godModeResetChannel: (correlationId: string) => `ryot:god-mode:reset:${correlationId}`,
	sandboxCache: (scriptId: string, key: string) => `ryot:sandbox:cache:${scriptId}:${key}`,
	integrationCache: (integrationId: string, key: string) =>
		`ryot:integrations:cache:${integrationId}:${key}`,
};

// The publisher (not the subscriber) knows whether it populated or translated, so the reason rides in
// the payload and becomes the `reason` of the fanned-out `entity:updated` frame.
export const EntityUpdatedReason = Schema.Literal("populated", "translated");
export type EntityUpdatedReason = typeof EntityUpdatedReason.Type;

export const EntityUpdatedMessage = Schema.Struct({
	entityId: EntityId,
	reason: EntityUpdatedReason,
});
export type EntityUpdatedMessage = typeof EntityUpdatedMessage.Type;

export const encodeEntityUpdatedMessage = (
	entityId: EntityId,
	reason: EntityUpdatedReason,
): string => JSON.stringify({ entityId, reason } satisfies EntityUpdatedMessage);

// Sync decoder for the ioredis message callback (not an Effect context).
export const decodeEntityUpdatedMessage = Schema.decodeUnknownEither(
	Schema.parseJson(EntityUpdatedMessage),
);

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
