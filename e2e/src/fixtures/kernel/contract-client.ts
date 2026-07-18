import {
	makeContractClient,
	type ContractProgram,
	type RequestHeaders,
} from "@ryot-app/contract/client";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { getApiUrl } from "~/support/harness-target";

export type ContractSession = {
	readonly userId?: UserId;
	call: <A, E>(program: ContractProgram<A, E>, headers?: RequestHeaders) => Effect.Effect<A, E>;
};

export const makeSession = (
	baseUrl = getApiUrl(),
	defaultHeaders: RequestHeaders = {},
	userId?: UserId,
): ContractSession => ({
	userId,
	call: (program, headers = {}) =>
		makeContractClient(baseUrl, { ...defaultHeaders, ...headers }).pipe(
			Effect.flatMap(program),
			Effect.provide(FetchHttpClient.layer),
		),
});

export const getApiClient = (baseUrl?: string): ContractSession => makeSession(baseUrl);

export async function postApiJson(path: string, body: unknown, token?: string) {
	return fetch(`${getApiUrl()}${path}`, {
		method: "POST",
		body: JSON.stringify(body),
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
	});
}
