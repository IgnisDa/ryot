import {
	makeContractClient,
	type ContractProgram,
	type RequestHeaders,
} from "@ryot-app/contract/client";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";
import type { HttpClient } from "effect/unstable/http";

import { getApiUrl } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

export type ContractSession = {
	readonly userId?: UserId;
	call: <A, E>(
		program: ContractProgram<A, E>,
		headers?: RequestHeaders,
	) => Effect.Effect<A, E, HttpClient.HttpClient>;
};

export const makeSession = (
	baseUrl = getApiUrl(),
	defaultHeaders: RequestHeaders = {},
	userId?: UserId,
): ContractSession => ({
	userId,
	call: (program, headers = {}) =>
		makeContractClient(baseUrl, { ...defaultHeaders, ...headers }).pipe(Effect.flatMap(program)),
});

export const getApiClient = (baseUrl?: string): ContractSession => makeSession(baseUrl);

export const postApiJson = (path: string, body: unknown, token?: string) =>
	Effect.gen(function* () {
		return yield* webRequest(`${getApiUrl()}${path}`, {
			method: "POST",
			body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(body),
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
		});
	});
