import { makeContractClient, type RequestHeaders } from "@ryot/contract/client";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { fetch as expoFetch } from "expo/fetch";

import { contractRequestOptions } from "@/api/request-options";
import { getAuthCookie } from "@/modules/auth/storage";
import { serverUrlReader } from "@/modules/server/storage";
import { appStorageLayer } from "@/persistence/storage";

const expoFetchLayer = Layer.succeed(
	FetchHttpClient.Fetch,
	// Expo's FetchResponse implements the web response surface consumed by FetchHttpClient.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	expoFetch as unknown as typeof globalThis.fetch,
);

const expoHttpClientLayer = FetchHttpClient.layer.pipe(Layer.provide(expoFetchLayer));

const makeRequestLayer = <R>(options: {
	authenticated?: boolean;
	headers?: RequestHeaders;
	httpClientLayer: Layer.Layer<HttpClient.HttpClient>;
	serverUrlReader: Effect.Effect<() => Effect.Effect<string>, never, R>;
}) =>
	Layer.effect(
		HttpClient.HttpClient,
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			const readServerUrl = yield* options.serverUrlReader;
			const mappedClient = client.pipe(
				HttpClient.mapRequestEffect((request) =>
					readServerUrl().pipe(
						Effect.map((serverUrl) => {
							const requestOptions = contractRequestOptions({
								serverUrl,
								headers: options.headers,
								authenticated: options.authenticated,
								authCookie: options.authenticated ? getAuthCookie(serverUrl) : undefined,
							});
							return request.pipe(
								HttpClientRequest.prependUrl(requestOptions.baseUrl),
								HttpClientRequest.setHeaders(requestOptions.headers),
							);
						}),
					),
				),
			);
			return options.authenticated
				? mappedClient.pipe(
						HttpClient.transformResponse(
							Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }),
						),
					)
				: mappedClient;
		}),
	).pipe(Layer.provide(options.httpClientLayer));

const fixedServerUrlReader = (serverUrl: string) => Effect.succeed(() => Effect.succeed(serverUrl));

const publicRequestLayer = (serverUrl: string) =>
	makeRequestLayer({
		serverUrlReader: fixedServerUrlReader(serverUrl),
		httpClientLayer: FetchHttpClient.layer,
	});

export const storedPublicRequestLayer = makeRequestLayer({
	serverUrlReader,
	httpClientLayer: FetchHttpClient.layer,
}).pipe(Layer.provide(appStorageLayer));

export const authenticatedRequestLayer = makeRequestLayer({
	serverUrlReader,
	authenticated: true,
	httpClientLayer: FetchHttpClient.layer,
}).pipe(Layer.provide(appStorageLayer));

export const adminTokenRequestLayer = (adminToken: string) =>
	makeRequestLayer({
		serverUrlReader,
		authenticated: true,
		httpClientLayer: FetchHttpClient.layer,
		headers: { "Admin-Access-Token": adminToken },
	}).pipe(Layer.provide(appStorageLayer));

const authenticatedExpoRequestLayer = (serverUrl: string) =>
	makeRequestLayer({
		authenticated: true,
		httpClientLayer: expoHttpClientLayer,
		serverUrlReader: fixedServerUrlReader(serverUrl),
	});

export const publicContractClient = (serverUrl: string) =>
	makeContractClient("").pipe(Effect.provide(publicRequestLayer(serverUrl)));

export const authenticatedExpoContractClient = (serverUrl: string) =>
	makeContractClient("").pipe(Effect.provide(authenticatedExpoRequestLayer(serverUrl)));
