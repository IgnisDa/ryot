import type { ContractSuccess } from "@ryot/contract/client";
import { AppContract } from "@ryot/contract/contract";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Atom, AtomHttpApi, Reactivity } from "effect/unstable/reactivity";

import { serverStorageLayer, serverUrlReader } from "@/modules/server/storage";

export type GodModeUser = ContractSuccess<"godMode", "listUsers">["users"][number];

export const adminTokenAtom = Atom.make("");

const usersReactivityKey = ["god-mode-users"];

const httpClientLayer = (get: Atom.AtomContext) => {
	const adminToken = get(adminTokenAtom);
	return Layer.effect(
		HttpClient.HttpClient,
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			const readServerUrl = yield* serverUrlReader;
			return client.pipe(
				HttpClient.mapRequestEffect((request) =>
					readServerUrl().pipe(
						Effect.map((serverUrl) =>
							request.pipe(
								HttpClientRequest.prependUrl(`${serverUrl}/api`),
								HttpClientRequest.setHeader("Admin-Access-Token", adminToken),
							),
						),
					),
				),
				HttpClient.transformResponse(
					Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }),
				),
			);
		}),
	).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(serverStorageLayer));
};

const godModeApiOptions = { api: AppContract, httpClient: httpClientLayer };

const GodModeApi = AtomHttpApi.Service()("GodModeApi", godModeApiOptions);

export const godModeUsersAtom = GodModeApi.query("godMode", "listUsers", {
	query: { limit: 100, offset: 0 },
	reactivityKeys: usersReactivityKey,
}).pipe(Atom.swr({ staleTime: 0, revalidateOnMount: true }), Atom.setIdleTTL("5 minutes"));

export const resetUserPasswordAtom = Atom.family((userId: string) =>
	GodModeApi.runtime.fn(() =>
		Effect.flatMap(GodModeApi, (client) =>
			client.godMode.resetUserPassword({ params: { userId: UserId.make(userId) } }),
		),
	),
);

export const setUserDisabledAtom = Atom.family((userId: string) =>
	GodModeApi.runtime.fn((disabled: boolean) =>
		Effect.flatMap(GodModeApi, (client) =>
			Reactivity.mutation(
				client.godMode.setUserDisabled({
					params: { userId: UserId.make(userId) },
					payload: { disabled },
				}),
				usersReactivityKey,
			),
		),
	),
);
