import {
	runContract,
	runContractError,
	type ContractProgram,
	type RequestHeaders,
} from "@ryot/contract/client";

import { getBackendUrl } from "~/setup";

export type {
	ContractPayload,
	ContractPathParams,
	ContractSuccess,
	ContractUrlParams,
} from "@ryot/contract/client";

export type ContractSession = {
	run: <A, E>(program: ContractProgram<A, E>, headers?: RequestHeaders) => Promise<A>;
	runError: <A, E>(program: ContractProgram<A, E>, headers?: RequestHeaders) => Promise<E>;
};

export const makeSession = (
	baseUrl = getBackendUrl(),
	defaultHeaders: RequestHeaders = {},
): ContractSession => ({
	run: (program, headers = {}) =>
		runContract(program, { baseUrl, headers: { ...defaultHeaders, ...headers } }),
	runError: (program, headers = {}) =>
		runContractError(program, { baseUrl, headers: { ...defaultHeaders, ...headers } }),
});

export const getBackendClient = (): ContractSession => makeSession();

export async function postBackendJson(path: string, body: unknown, cookies?: string) {
	return fetch(`${getBackendUrl()}${path}`, {
		method: "POST",
		body: JSON.stringify(body),
		headers: { "Content-Type": "application/json", ...(cookies ? { Cookie: cookies } : {}) },
	});
}
