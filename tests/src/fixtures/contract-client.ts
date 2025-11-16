import { FetchHttpClient, HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { AppContract } from "@ryot/app-backend/contract";
import { Effect } from "effect";

import { getBackendUrl } from "../setup";

type RequestHeaders = Record<string, string>;

const makeContractClient = (baseUrl: string, headers: RequestHeaders) =>
	HttpApiClient.make(AppContract, {
		baseUrl,
		...(Object.keys(headers).length
			? { transformClient: HttpClient.mapRequest(HttpClientRequest.setHeaders(headers)) }
			: {}),
	});

type ContractClient = Effect.Effect.Success<ReturnType<typeof makeContractClient>>;
type ContractProgram<A, E> = (client: ContractClient) => Effect.Effect<A, E>;

const runProgram = <A, E>(
	program: ContractProgram<A, E>,
	headers: RequestHeaders,
	baseUrl: string,
): Promise<A> =>
	makeContractClient(baseUrl, headers).pipe(
		Effect.flatMap(program),
		Effect.provide(FetchHttpClient.layer),
		Effect.runPromise,
	);

const runContract = <A, E>(
	program: ContractProgram<A, E>,
	headers: RequestHeaders = {},
	baseUrl = getBackendUrl(),
): Promise<A> => runProgram(program, headers, baseUrl);

const runContractError = <A, E>(
	program: ContractProgram<A, E>,
	headers: RequestHeaders = {},
	baseUrl = getBackendUrl(),
): Promise<E> => runProgram((client) => Effect.flip(program(client)), headers, baseUrl);

export type ContractSession = {
	run: <A, E>(program: ContractProgram<A, E>, headers?: RequestHeaders) => Promise<A>;
	runError: <A, E>(program: ContractProgram<A, E>, headers?: RequestHeaders) => Promise<E>;
};

export const makeSession = (
	baseUrl = getBackendUrl(),
	defaultHeaders: RequestHeaders = {},
): ContractSession => ({
	run: (program, headers = {}) => runContract(program, { ...defaultHeaders, ...headers }, baseUrl),
	runError: (program, headers = {}) =>
		runContractError(program, { ...defaultHeaders, ...headers }, baseUrl),
});

export const getBackendClient = (): ContractSession => makeSession();

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
