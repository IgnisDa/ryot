import type { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient, type HttpApiEndpoint, type HttpApiGroup } from "effect/http-api";

import { AppContract, type AppGroups } from "./contract";

export type RequestHeaders = Record<string, string>;

export const makeContractClient = (
	baseUrl: string,
	headers: RequestHeaders = {},
): ReturnType<typeof HttpApiClient.make<"ryot", AppGroups>> =>
	HttpApiClient.make(AppContract, {
		baseUrl,
		...(Object.keys(headers).length
			? { transformClient: HttpClient.mapRequest(HttpClientRequest.setHeaders(headers)) }
			: {}),
	});

export type ContractClient = Effect.Success<ReturnType<typeof makeContractClient>>;
export type ContractProgram<A, E> = (client: ContractClient) => Effect.Effect<A, E>;

export type ContractPayload<G extends GroupKey, M extends MethodKey<G>> =
	ContractRequest<G, M> extends { payload: infer P } ? P : never;
export type ContractUrlParams<G extends GroupKey, M extends MethodKey<G>> =
	ContractRequest<G, M> extends { query: infer U } ? U : never;
export type ContractPathParams<G extends GroupKey, M extends MethodKey<G>> =
	ContractRequest<G, M> extends { params: infer P } ? P : never;
export type ContractSuccess<G extends GroupKey, M extends MethodKey<G>> = HttpApiClient.SuccessType<
	HttpApiEndpoint.Success<ContractEndpoint<G, M>>
>;

export type ContractRequest<
	G extends GroupKey,
	M extends MethodKey<G>,
> = HttpApiEndpoint.ClientRequest<
	ContractEndpoint<G, M>["~Params"],
	ContractEndpoint<G, M>["~Query"],
	ContractEndpoint<G, M>["~Payload"],
	ContractEndpoint<G, M>["~Headers"],
	"decoded-only"
>;
type GroupKey = keyof ContractClient;
type MethodKey<G extends GroupKey> = keyof ContractClient[G];
type ContractEndpoint<G extends GroupKey, M extends MethodKey<G>> = HttpApiEndpoint.WithIdentifier<
	HttpApiGroup.EndpointsWithIdentifier<AppGroups, G>,
	Extract<M, string>
>;
