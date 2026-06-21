import { AtomHttpApi } from "@effect-atom/atom-react";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { AppContract } from "@ryot/contract/contract";
import { Effect, Layer } from "effect";

import { getAuthCookie } from "@/modules/auth/client";
import { serverStorageLayer, serverUrlReader } from "@/modules/server/state";

const httpClientLayer = Layer.effect(
	HttpClient.HttpClient,
	Effect.gen(function* () {
		const readServerUrl = yield* serverUrlReader;
		const client = yield* HttpClient.HttpClient;
		return client.pipe(
			HttpClient.mapRequestEffect((request) =>
				readServerUrl().pipe(
					Effect.map((serverUrl) => {
						const cookie = getAuthCookie(serverUrl);
						const withBaseUrl = HttpClientRequest.prependUrl(request, `${serverUrl}/api`);
						return cookie
							? HttpClientRequest.setHeader(withBaseUrl, "Cookie", cookie)
							: withBaseUrl;
					}),
				),
			),
			HttpClient.transformResponse(
				Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }),
			),
		);
	}),
).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(serverStorageLayer));

export class AppApi extends AtomHttpApi.Tag<AppApi>()("AppApi", {
	api: AppContract,
	httpClient: httpClientLayer,
}) {}
