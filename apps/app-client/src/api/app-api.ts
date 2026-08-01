import { AppContract } from "@ryot/contract/contract";
import { Effect, Schedule } from "effect";
import { AtomHttpApi } from "effect/unstable/reactivity";

import { authenticatedRequestLayer, storedPublicRequestLayer } from "@/api/transport";

const retrySchedule = Schedule.exponential("1 second").pipe(Schedule.upTo({ times: 3 }));

export const retryQueryResponse = Effect.retry(retrySchedule);

const appApiOptions = { api: AppContract, httpClient: authenticatedRequestLayer };

export const AppApi = AtomHttpApi.Service()("AppApi", appApiOptions);

export const PublicApi = AtomHttpApi.Service()("PublicApi", {
	api: AppContract,
	httpClient: storedPublicRequestLayer,
});

export const AppQueryApi = AtomHttpApi.Service()("AppQueryApi", {
	...appApiOptions,
	transformResponse: retryQueryResponse,
});
