import {
	makeContractClient,
	type ContractProgram,
	type RequestHeaders,
} from "@ryot/contract/client";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { getApiUrl } from "~/support/api";

export type ContractSession = {
	call: <A, E>(program: ContractProgram<A, E>, headers?: RequestHeaders) => Effect.Effect<A, E>;
};

export const makeSession = (
	baseUrl = getApiUrl(),
	defaultHeaders: RequestHeaders = {},
): ContractSession => ({
	call: (program, headers = {}) =>
		makeContractClient(baseUrl, { ...defaultHeaders, ...headers }).pipe(
			Effect.flatMap(program),
			Effect.provide(FetchHttpClient.layer),
		),
});

export const getApiClient = (baseUrl?: string): ContractSession => makeSession(baseUrl);

export async function postApiJson(path: string, body: unknown, cookies?: string) {
	return fetch(`${getApiUrl()}${path}`, {
		method: "POST",
		body: JSON.stringify(body),
		headers: { "Content-Type": "application/json", ...(cookies ? { Cookie: cookies } : {}) },
	});
}
