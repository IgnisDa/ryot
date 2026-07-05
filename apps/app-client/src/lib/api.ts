import { Atom, AtomHttpApi } from "@effect-atom/atom-react";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { makeContractClient } from "@ryot/contract/client";
import { AppContract } from "@ryot/contract/contract";
import { Effect, Layer, Option } from "effect";

import { getAuthCookie } from "@/lib/auth";
import { CLOUD_URL } from "@/lib/server";
import {
	serverStorageLayer,
	serverUrlAtom,
	serverUrlKey,
	serverUrlStorage,
} from "@/lib/store/server";

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

const publicApiRuntime = Atom.runtime(FetchHttpClient.layer);

export const systemConfigAtom = publicApiRuntime.atom((get) =>
	makeContractClient(`${get(serverUrlAtom) ?? CLOUD_URL}/api`).pipe(
		Effect.flatMap((client) => client.system.config()),
	),
);

export const connectToServerAtom = publicApiRuntime.fn((serverUrl: string) =>
	makeContractClient(`${serverUrl}/api`).pipe(Effect.flatMap((client) => client.system.health())),
);
