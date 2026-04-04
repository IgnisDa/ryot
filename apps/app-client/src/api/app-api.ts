import { AppContract } from "@ryot/contract/contract";
import { Effect, Layer, Schedule } from "effect";
import { AtomHttpApi } from "effect/unstable/reactivity";

import {
	authenticatedRequestLayer,
	publicRequestLayer,
	transportEnvironmentLive,
} from "@/api/transport";
import { normalizeServerOrigin } from "@/modules/server/url";

const retrySchedule = Schedule.exponential("1 second").pipe(Schedule.upTo({ times: 3 }));

export const retryQueryResponse = Effect.retry(retrySchedule);

const appApis = new Map<string, ReturnType<typeof createAppApi>>();
const publicApis = new Map<string, ReturnType<typeof createPublicApi>>();
const appQueryApis = new Map<string, ReturnType<typeof createAppQueryApi>>();

const createAppApi = (serverUrl: string) =>
	AtomHttpApi.Service()("AppApi", {
		api: AppContract,
		httpClient: authenticatedRequestLayer(serverUrl).pipe(Layer.provide(transportEnvironmentLive)),
	});

const createPublicApi = (serverUrl: string) =>
	AtomHttpApi.Service()("PublicApi", {
		api: AppContract,
		httpClient: publicRequestLayer(serverUrl).pipe(Layer.provide(transportEnvironmentLive)),
	});

const createAppQueryApi = (serverUrl: string) =>
	AtomHttpApi.Service()("AppQueryApi", {
		api: AppContract,
		transformResponse: retryQueryResponse,
		httpClient: authenticatedRequestLayer(serverUrl).pipe(Layer.provide(transportEnvironmentLive)),
	});

const getApi = <Api>(
	serverUrl: string,
	apis: Map<string, Api>,
	create: (serverUrl: string) => Api,
) => {
	const normalizedServerUrl = normalizeServerOrigin(serverUrl);
	const existing = apis.get(normalizedServerUrl);
	if (existing) {
		return existing;
	}

	const api = create(normalizedServerUrl);
	apis.set(normalizedServerUrl, api);
	return api;
};

export const makeAppApi = (serverUrl: string) => getApi(serverUrl, appApis, createAppApi);

export const makePublicApi = (serverUrl: string) => getApi(serverUrl, publicApis, createPublicApi);

export const makeAppQueryApi = (serverUrl: string) =>
	getApi(serverUrl, appQueryApis, createAppQueryApi);
