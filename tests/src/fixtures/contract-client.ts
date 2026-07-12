import {
	makeContractClient,
	type ContractProgram,
	type RequestHeaders,
} from "@ryot/contract/client";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { getBackendUrl } from "~/support/backend";

export type ContractSession = {
	call: <A, E>(program: ContractProgram<A, E>, headers?: RequestHeaders) => Effect.Effect<A, E>;
};

export const makeSession = (
	baseUrl = getBackendUrl(),
	defaultHeaders: RequestHeaders = {},
): ContractSession => ({
	call: (program, headers = {}) =>
		makeContractClient(baseUrl, { ...defaultHeaders, ...headers }).pipe(
			Effect.flatMap(program),
			Effect.provide(FetchHttpClient.layer),
		),
});

export const getBackendClient = (): ContractSession => makeSession();

export async function postBackendJson(path: string, body: unknown, cookies?: string) {
	return fetch(`${getBackendUrl()}${path}`, {
		method: "POST",
		body: JSON.stringify(body),
		headers: { "Content-Type": "application/json", ...(cookies ? { Cookie: cookies } : {}) },
	});
}
