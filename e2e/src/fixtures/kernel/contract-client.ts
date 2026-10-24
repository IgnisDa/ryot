import {
	type ContractProgram,
	makeContractClient,
	type RequestHeaders,
} from "@ryot-app/contract/client";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";
import type { HttpClient } from "effect/http";

import { getSharedHarnessTarget, type HarnessTarget } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

export type ContractSession = {
	readonly target: HarnessTarget;
	readonly userId?: UserId;
	call: <A, E>(
		program: ContractProgram<A, E>,
		headers?: RequestHeaders,
	) => Effect.Effect<A, E, HttpClient.HttpClient>;
	adminCall: <A, E>(program: ContractProgram<A, E>) => Effect.Effect<A, E, HttpClient.HttpClient>;
};

export const makeSession = (
	target = getSharedHarnessTarget(),
	defaultHeaders: RequestHeaders = {},
	userId?: UserId,
): ContractSession => {
	const sessionHeaders = { ...defaultHeaders };
	return Object.freeze({
		userId,
		target,
		call: (program, headers = {}) =>
			makeContractClient(target.apiUrl, { ...sessionHeaders, ...headers }).pipe(
				Effect.flatMap(program),
			),
		adminCall: (program) =>
			makeContractClient(target.apiUrl, {
				...sessionHeaders,
				"Admin-Access-Token": target.adminAccessToken,
			}).pipe(Effect.flatMap(program)),
	});
};

export const getApiClient = (target?: HarnessTarget): ContractSession => makeSession(target);

export const postApiJson = (client: ContractSession, path: string, body: unknown, token?: string) =>
	Effect.gen(function* () {
		return yield* webRequest(`${client.target.apiUrl}${path}`, {
			method: "POST",
			body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(body),
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
		});
	});
