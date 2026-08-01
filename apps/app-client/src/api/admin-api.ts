import { AppContract } from "@ryot/contract/contract";
import { AtomHttpApi } from "effect/unstable/reactivity";

import { retryQueryResponse } from "@/api/app-api";
import { adminTokenRequestLayer } from "@/api/transport";

export const makeAdminApi = (adminToken: string) =>
	AtomHttpApi.Service()("AdminApi", {
		api: AppContract,
		httpClient: adminTokenRequestLayer(adminToken),
	});

export const makeAdminQueryApi = (adminToken: string) =>
	AtomHttpApi.Service()("AdminQueryApi", {
		api: AppContract,
		transformResponse: retryQueryResponse,
		httpClient: adminTokenRequestLayer(adminToken),
	});
