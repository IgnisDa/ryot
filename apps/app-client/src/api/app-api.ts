import { AppContract } from "@ryot/contract/contract";
import { Effect, Layer, Schedule } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { AtomHttpApi } from "effect/unstable/reactivity";

import { getAuthCookie } from "@/modules/auth/client";
import { serverStorageLayer, serverUrlReader } from "@/modules/server/state";

const retrySchedule = Schedule.exponential("1 second").pipe(Schedule.upTo({ times: 3 }));

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

const appApiOptions = { api: AppContract, httpClient: httpClientLayer };

export const AppApi = AtomHttpApi.Service()("AppApi", appApiOptions);

export const AppQueryApi = AtomHttpApi.Service()("AppQueryApi", {
	...appApiOptions,
	transformResponse: Effect.retry(retrySchedule),
});
