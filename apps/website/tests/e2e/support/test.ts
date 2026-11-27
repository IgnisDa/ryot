import { BunCrypto } from "@effect/platform-bun";
import { layer } from "@voila.dev/effect-bun-test";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";

export const websiteTest = layer(Layer.merge(FetchHttpClient.layer, BunCrypto.layerSecureRandom), {
	excludeTestServices: true,
});
