import { AppContract } from "@ryot-app/contract/contract";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect, Layer, Result, Schedule } from "effect";
import type { AsyncResult } from "effect/unstable/reactivity";
import { AsyncResult as AsyncResultValue, Atom, AtomHttpApi } from "effect/unstable/reactivity";
import * as Network from "expo-network";
import { AppState } from "react-native";

import { resolveApiUrl } from "./origin";
import { apiScopeKey, canonicalApiScope, type ApiScope, serverRequestKey } from "./request-key";
import { RyotQLMalformedResultError } from "./ryotql";
import {
	authenticatedExpoContractClient,
	authenticatedRequestLayer,
	publicContractClient,
	publicRequestLayer,
	transportEnvironmentLive,
} from "./transport";

const retrySchedule = Schedule.exponential("1 second").pipe(Schedule.upTo({ times: 3 }));

export const retryQueryResponse = Effect.retry(retrySchedule);

const decodeRecipe = <Success>(recipe: PreparedRecipe<Success>, response: unknown) =>
	Result.mapError(recipe.decode(response), (detail) => new RyotQLMalformedResultError(detail));

const decodeRecipeEffect = <Success>(recipe: PreparedRecipe<Success>, response: unknown) => {
	const decoded = decodeRecipe(recipe, response);
	return Result.isFailure(decoded) ? Effect.fail(decoded.failure) : Effect.succeed(decoded.success);
};

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
	const request = authenticatedExpoContractClient(scope.serverUrl);
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
	const executeRecipe = <Success>(recipe: PreparedRecipe<Success>) =>
		request.pipe(
			Effect.flatMap((client) => client.ryotql.execute({ payload: recipe.document })),
			retryQueryResponse,
			Effect.flatMap((response) => decodeRecipeEffect(recipe, response)),
		);
	return {
		query,
		request,
		mutation: appApi.mutation,
		resolveApiUrl: (url: string) => resolveApiUrl(scope.serverUrl, url),
		ryotql: {
			execute: executeRecipe,
			query: <Success>(
				recipe: PreparedRecipe<Success>,
				options: { readonly reactivityKeys?: readonly unknown[] | undefined } = {},
			) => {
				const decodedQuery = queryApi
					.query("ryotql", "execute", { ...options, payload: recipe.document })
					.pipe(
						Atom.map((result): AsyncResult.AsyncResult<Success, unknown> => {
							if (AsyncResultValue.isFailure(result)) {
								return AsyncResultValue.failure<Success, unknown>(result.cause, {
									waiting: result.waiting,
								});
							}
							if (!AsyncResultValue.isSuccess(result)) {
								return AsyncResultValue.initial<Success, unknown>(result.waiting);
							}
							const decoded = decodeRecipe(recipe, result.value);
							return Result.isFailure(decoded)
								? AsyncResultValue.fail(decoded.failure, {
										waiting: result.waiting,
									})
								: AsyncResultValue.success(decoded.success, {
										waiting: result.waiting,
										timestamp: result.timestamp,
									});
						}),
					);
				return withAppQueryDefaults(decodedQuery);
			},
		},
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
