import { BunCrypto, BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import { Turnstile } from "./turnstile.server";

const serverLayer = Layer.mergeAll(
	BunCrypto.layerSecureRandom,
	BunServices.layer,
	Turnstile.layer.pipe(Layer.provideMerge(FetchHttpClient.layer)),
);

export const runPromise = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof serverLayer>>) =>
	Effect.runPromise(effect.pipe(Effect.provide(serverLayer)));
