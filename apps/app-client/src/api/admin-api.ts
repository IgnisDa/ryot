import { AppContract } from "@ryot/contract/contract";
import { Layer } from "effect";
import { AtomHttpApi } from "effect/unstable/reactivity";

import { retryQueryResponse } from "@/api/app-api";
import { adminTokenRequestLayer, transportEnvironmentLive } from "@/api/transport";

export const makeAdminApi = (serverUrl: string, adminToken: string) =>
	AtomHttpApi.Service()("AdminApi", {
		api: AppContract,
		httpClient: adminTokenRequestLayer(serverUrl, adminToken).pipe(
			Layer.provide(transportEnvironmentLive),
		),
	});

export const makeAdminQueryApi = (serverUrl: string, adminToken: string) =>
	AtomHttpApi.Service()("AdminQueryApi", {
		api: AppContract,
		transformResponse: retryQueryResponse,
		httpClient: adminTokenRequestLayer(serverUrl, adminToken).pipe(
			Layer.provide(transportEnvironmentLive),
		),
	});
