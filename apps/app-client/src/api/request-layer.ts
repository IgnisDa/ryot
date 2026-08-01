import type { RequestHeaders } from "@ryot/contract/client";
import { Context, Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

import { normalizeServerOrigin, serverApiUrl } from "@/api/origin";

type Fetch = typeof globalThis.fetch;

export class TransportEnvironment extends Context.Service<
	TransportEnvironment,
	{
		readonly fetch: Fetch;
		readonly expoFetch: Fetch;
		readonly getAuthCookie: (serverUrl: string) => Promise<string | undefined>;
	}
>()("@ryot/app-client/TransportEnvironment") {}

const fetchHttpClientLayer = (useExpoFetch: boolean) =>
	FetchHttpClient.layer.pipe(
		Layer.provide(
			Layer.effect(
				FetchHttpClient.Fetch,
				Effect.map(TransportEnvironment, (environment) =>
					useExpoFetch ? environment.expoFetch : environment.fetch,
				),
			),
		),
	);

const makeRequestLayer = (options: {
	authenticated?: boolean;
	headers?: RequestHeaders;
	serverUrl: string;
	useExpoFetch?: boolean;
}) => {
	const serverUrl = normalizeServerOrigin(options.serverUrl);
	return Layer.effect(
		HttpClient.HttpClient,
		Effect.gen(function* () {
			const environment = yield* TransportEnvironment;
			const client = yield* HttpClient.HttpClient;
			const mappedClient = client.pipe(
				HttpClient.mapRequestEffect((request) =>
					Effect.gen(function* () {
						const authCookie = options.authenticated
							? yield* Effect.promise(() => environment.getAuthCookie(serverUrl))
							: undefined;
						return request.pipe(
							HttpClientRequest.prependUrl(serverApiUrl(serverUrl)),
							HttpClientRequest.setHeaders({
								...options.headers,
								...(authCookie ? { Cookie: authCookie } : {}),
							}),
						);
					}),
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
	).pipe(Layer.provide(fetchHttpClientLayer(options.useExpoFetch === true)));
};

export const publicRequestLayer = (serverUrl: string) => makeRequestLayer({ serverUrl });

export const authenticatedRequestLayer = (serverUrl: string) =>
	makeRequestLayer({ serverUrl, authenticated: true });

export const adminTokenRequestLayer = (serverUrl: string, adminToken: string) =>
	makeRequestLayer({
		serverUrl,
		authenticated: true,
		headers: { "Admin-Access-Token": adminToken },
	});

export const authenticatedExpoRequestLayer = (serverUrl: string) =>
	makeRequestLayer({ serverUrl, authenticated: true, useExpoFetch: true });
