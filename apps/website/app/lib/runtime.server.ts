import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

const serverLayer = Layer.merge(BunServices.layer, FetchHttpClient.layer);

export const runPromise = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof serverLayer>>) =>
	Effect.runPromise(effect.pipe(Effect.provide(serverLayer)));
