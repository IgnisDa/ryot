import { AppContract } from "@ryot/contract/contract";
import { Effect, Layer, Schedule } from "effect";
import type { AsyncResult } from "effect/unstable/reactivity";
import { Atom, AtomHttpApi } from "effect/unstable/reactivity";
import * as Network from "expo-network";
import { AppState } from "react-native";

import { resolveApiUrl } from "./origin";
import { apiScopeKey, canonicalApiScope, type ApiScope, serverRequestKey } from "./request-key";
import {
	authenticatedExpoContractClient,
	authenticatedRequestLayer,
	publicContractClient,
	publicRequestLayer,
	transportEnvironmentLive,
} from "./transport";

const retrySchedule = Schedule.exponential("1 second").pipe(Schedule.upTo({ times: 3 }));

export const retryQueryResponse = Effect.retry(retrySchedule);

export const appRevalidationSignal = Atom.readable((get) => {
	let version = 0;
	let wasConnected: boolean | undefined;

	const revalidate = () => get.setSelf(++version);
	const appStateSubscription = AppState.addEventListener("change", (state) => {
		if (state === "active") {
			revalidate();
		}
	});
	const networkSubscription = Network.addNetworkStateListener(({ isConnected }) => {
		if (isConnected === true && wasConnected === false) {
			revalidate();
		}
		if (isConnected !== undefined) {
			wasConnected = isConnected;
		}
	});

	get.addFinalizer(() => {
		appStateSubscription.remove();
		networkSubscription.remove();
	});

	return version;
});

export function withAppQueryDefaults<A, E>(query: Atom.Atom<AsyncResult.AsyncResult<A, E>>) {
	return query.pipe(
		Atom.swr({
			staleTime: 0,
			revalidateOnFocus: true,
			revalidateOnMount: true,
			focusSignal: appRevalidationSignal,
		}),
		Atom.setIdleTTL("5 minutes"),
	);
}

const createAppClient = (scope: ApiScope) => {
	const appApi = AtomHttpApi.Service()("AppApi", {
		api: AppContract,
		httpClient: authenticatedRequestLayer(scope.serverUrl).pipe(
			Layer.provide(transportEnvironmentLive),
		),
	});
	const queryApi = AtomHttpApi.Service()("AppQueryApi", {
		api: AppContract,
		transformResponse: retryQueryResponse,
		httpClient: authenticatedRequestLayer(scope.serverUrl).pipe(
			Layer.provide(transportEnvironmentLive),
		),
	});
	const query: typeof queryApi.query = new Proxy(queryApi.query, {
		apply(target, thisArg, argumentsList) {
			return withAppQueryDefaults(Reflect.apply(target, thisArg, argumentsList));
		},
	});
	return {
		query,
		mutation: appApi.mutation,
		request: authenticatedExpoContractClient(scope.serverUrl),
		resolveApiUrl: (url: string) => resolveApiUrl(scope.serverUrl, url),
	};
};

const appClients = new Map<string, ReturnType<typeof createAppClient>>();

export const appClient = (input: ApiScope) => {
	const scope = canonicalApiScope(input);
	const key = apiScopeKey(scope);
	const existing = appClients.get(key);
	if (existing) {
		return existing;
	}
	const client = createAppClient(scope);
	appClients.set(key, client);
	return client;
};

const createPublicClient = (serverUrl: string) => {
	const api = AtomHttpApi.Service()("PublicApi", {
		api: AppContract,
		httpClient: publicRequestLayer(serverUrl).pipe(Layer.provide(transportEnvironmentLive)),
	});
	return { query: api.query, request: publicContractClient(serverUrl) };
};

const publicClients = new Map<string, ReturnType<typeof createPublicClient>>();

export const publicClient = (serverUrl: string) => {
	const key = serverRequestKey(serverUrl);
	const existing = publicClients.get(key);
	if (existing) {
		return existing;
	}
	const client = createPublicClient(serverUrl);
	publicClients.set(key, client);
	return client;
};
