import { Context, Effect, Layer, Redacted } from "effect";
import Redis from "ioredis";

import { AppConfig } from "./config/service";

export const redisKeys = {
	entityUpdatedChannel: "ryot:entity:updated",
	pluginRegistryChannel: "ryot:plugins:registry",
	uploadToken: (token: string) => `ryot:upload:token:${token}`,
	godModePendingReset: (email: string) => `ryot:god-mode:pending:${email}`,
	sandboxSession: (executionId: string) => `ryot:sandbox:session:${executionId}`,
	importSourcePayload: (runId: string) => `ryot:imports:source-payload:${runId}`,
	importAdapterResult: (runId: string) => `ryot:imports:adapter-result:${runId}`,
	godModeResetChannel: (correlationId: string) => `ryot:god-mode:reset:${correlationId}`,
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
}) {
	static readonly layer = Layer.effect(this, this.make);
}
