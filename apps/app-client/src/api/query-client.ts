import type { AsyncResult } from "effect/unstable/reactivity";
import { Atom } from "effect/unstable/reactivity";
import * as Network from "expo-network";
import { AppState } from "react-native";

import { AppApi, AppQueryApi } from "@/api/app-api";

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

const query = new Proxy(AppQueryApi.query, {
	apply(target, thisArg, argumentsList) {
		return withQueryDefaults(Reflect.apply(target, thisArg, argumentsList));
	},
});

export const appQueryClient = { mutation: AppApi.mutation, query };
