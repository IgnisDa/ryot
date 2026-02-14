import { FetchHttpClient, HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "./contract";

export type RequestHeaders = Record<string, string>;

export const makeContractClient = (baseUrl: string, headers: RequestHeaders = {}) =>
	HttpApiClient.make(AppContract, {
		baseUrl,
		...(Object.keys(headers).length
			? { transformClient: HttpClient.mapRequest(HttpClientRequest.setHeaders(headers)) }
			: {}),
	});

export type ContractClient = Effect.Effect.Success<ReturnType<typeof makeContractClient>>;
export type ContractProgram<A, E> = (client: ContractClient) => Effect.Effect<A, E>;

export interface RunContractOptions {
	baseUrl: string;
	headers?: RequestHeaders;
	credentials?: RequestCredentials;
}

export const runContract = <A, E>(
	program: ContractProgram<A, E>,
	{ baseUrl, headers = {}, credentials }: RunContractOptions,
): Promise<A> => {
	const program$ = makeContractClient(baseUrl, headers).pipe(Effect.flatMap(program));
	const provisioned = credentials
		? program$.pipe(Effect.provideService(FetchHttpClient.RequestInit, { credentials }))
		: program$;
	return provisioned.pipe(Effect.provide(FetchHttpClient.layer), Effect.runPromise);
};

export const runContractError = <A, E>(
	program: ContractProgram<A, E>,
	options: RunContractOptions,
): Promise<E> => runContract((client) => Effect.flip(program(client)), options);

type StripResponseMeta<T> = T extends readonly [infer Data, unknown] ? Data : T;
type GroupKey = keyof ContractClient;
type MethodKey<G extends GroupKey> = keyof ContractClient[G];
type ClientRequest<G extends GroupKey, M extends MethodKey<G>> = ContractClient[G][M] extends (
	request: infer Req,
	...rest: never[]
) => unknown
	? Req
	: never;
type ClientSuccessValue<G extends GroupKey, M extends MethodKey<G>> = ContractClient[G][M] extends (
	...args: never[]
) => Effect.Effect<infer A, infer _E, infer _R>
	? A
	: never;

export type ContractPayload<G extends GroupKey, M extends MethodKey<G>> =
	ClientRequest<G, M> extends { payload: infer P } ? P : never;
export type ContractUrlParams<G extends GroupKey, M extends MethodKey<G>> =
	ClientRequest<G, M> extends { urlParams: infer U } ? U : never;
export type ContractPathParams<G extends GroupKey, M extends MethodKey<G>> =
	ClientRequest<G, M> extends { path: infer P } ? P : never;
export type ContractSuccess<G extends GroupKey, M extends MethodKey<G>> = StripResponseMeta<
	ClientSuccessValue<G, M>
>;
