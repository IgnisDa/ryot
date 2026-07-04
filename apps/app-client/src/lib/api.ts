import { Atom, AtomHttpApi } from "@effect-atom/atom-react";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { AppContract } from "@ryot/contract/contract";
import { Effect, Layer, Option } from "effect";

import { CLOUD_URL } from "@/lib/server";
import { serverStorageLayer, serverUrlKey, serverUrlStorage } from "@/lib/store/server";

const httpClientLayer = Layer.effect(
	HttpClient.HttpClient,
	Effect.gen(function* () {
		const serverUrls = yield* serverUrlStorage;
		const client = yield* HttpClient.HttpClient;
		return client.pipe(
			HttpClient.mapRequestEffect((request) =>
				serverUrls.get(serverUrlKey).pipe(
					Effect.orDie,
					Effect.map(Option.flatMap(Option.fromNullable)),
					Effect.map(Option.getOrElse(() => CLOUD_URL)),
					Effect.map((serverUrl) => HttpClientRequest.prependUrl(request, `${serverUrl}/api`)),
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

export const systemHealthAtom = Atom.family((serverUrl: string) =>
	AppApi.query("system", "health", {
		reactivityKeys: ["server-url", serverUrl],
	}),
);
