import { Effect, Layer } from "effect";

export class AppConfig extends Effect.Service<AppConfig>()("AppConfig", {
	effect: Effect.succeed({ name: "app" }),
}) {}

export class RedisService extends Effect.Service<RedisService>()("RedisService", {
	effect: Effect.succeed({ get: Effect.void }),
}) {
	static readonly layer = Layer.empty;
}
