import { Layer } from "effect";
import type { AsyncResult } from "effect/unstable/reactivity";
import { Atom } from "effect/unstable/reactivity";
import * as Network from "expo-network";
import { AppState } from "react-native";

import { makeAppApi, makeAppQueryApi } from "@/api/app-api";
import { AppQueryClient } from "@/api/query-client-service";
import { normalizeServerOrigin } from "@/modules/server/url";

const revalidationSignal = Atom.readable((get) => {
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

function withQueryDefaults<A, E>(query: Atom.Atom<AsyncResult.AsyncResult<A, E>>) {
	return query.pipe(
		Atom.swr({
			staleTime: 0,
			revalidateOnFocus: true,
			revalidateOnMount: true,
			focusSignal: revalidationSignal,
		}),
		Atom.setIdleTTL("5 minutes"),
	);
}

const clients = new Map<string, ReturnType<typeof createAppQueryClient>>();

const createAppQueryClient = (serverUrl: string) => {
	const appApi = makeAppApi(serverUrl);
	const appQueryApi = makeAppQueryApi(serverUrl);
	const query: typeof appQueryApi.query = new Proxy(appQueryApi.query, {
		apply(target, thisArg, argumentsList) {
			return withQueryDefaults(Reflect.apply(target, thisArg, argumentsList));
		},
	});
	return { mutation: appApi.mutation, query };
};

export const appQueryClient = (serverUrl: string) => {
	const normalizedServerUrl = normalizeServerOrigin(serverUrl);
	const existing = clients.get(normalizedServerUrl);
	if (existing) {
		return existing;
	}

	const client = createAppQueryClient(normalizedServerUrl);
	clients.set(normalizedServerUrl, client);
	return client;
};

export const appQueryClientLive = Layer.succeed(AppQueryClient, { get: appQueryClient });

export const withAppQueryDefaults = withQueryDefaults;
