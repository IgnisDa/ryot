import { makeContractClient } from "@ryot-app/contract/client";
import { Effect, Layer } from "effect";
import { fetch as expoFetch } from "expo/fetch";

import {
	authenticatedExpoRequestLayer,
	publicRequestLayer,
	TransportEnvironment,
} from "@/api/request-layer";
import { getAuthCookie } from "@/modules/auth/storage";

export {
	adminTokenRequestLayer,
	authenticatedExpoRequestLayer,
	authenticatedRequestLayer,
	publicRequestLayer,
} from "@/api/request-layer";

export const transportEnvironmentLive = Layer.succeed(TransportEnvironment, {
	getAuthCookie,
	fetch: globalThis.fetch,
	// Expo's FetchResponse implements the web response surface consumed by FetchHttpClient.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	expoFetch: expoFetch as unknown as typeof globalThis.fetch,
});

export const publicContractClient = (serverUrl: string) =>
	makeContractClient("").pipe(
		Effect.provide(publicRequestLayer(serverUrl)),
		Effect.provide(transportEnvironmentLive),
	);

export const authenticatedExpoContractClient = (serverUrl: string) =>
	makeContractClient("").pipe(
		Effect.provide(authenticatedExpoRequestLayer(serverUrl)),
		Effect.provide(transportEnvironmentLive),
	);
