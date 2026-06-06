import { FetchHttpClient, HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { AppContract } from "@ryot/app-backend/contract";
import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { useMemo } from "react";

import { useAuthClient, useServerUrl } from "@/lib/atoms";
import { CLOUD_URL } from "@/lib/server";

type RequestHeaders = Record<string, string>;
type ContractMethod = (...args: never[]) => Effect.Effect<unknown, unknown, unknown>;
type StripResponseMeta<T> = T extends readonly [infer Data, unknown] ? Data : T;

const makeContractClient = (serverUrl: string, headers: RequestHeaders) =>
	HttpApiClient.make(AppContract, {
		baseUrl: `${serverUrl}/api`,
		...(Object.keys(headers).length
			? { transformClient: HttpClient.mapRequest(HttpClientRequest.setHeaders(headers)) }
			: {}),
	});

export type ContractClient = Effect.Effect.Success<ReturnType<typeof makeContractClient>>;
export type ContractSuccess<T extends ContractMethod> = StripResponseMeta<
	Effect.Effect.Success<ReturnType<T>>
>;

export type ContractRunner = <A, E>(
	run: (client: ContractClient) => Effect.Effect<A, E>,
) => Promise<A>;

export function createContractRunner(
	serverUrl: string,
	headers: RequestHeaders = {},
): ContractRunner {
	return (run) =>
		makeContractClient(serverUrl, headers).pipe(
			Effect.flatMap(run),
			Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }),
			Effect.provide(FetchHttpClient.layer),
			Effect.runPromise,
		);
}

export function useContractClient(): ContractRunner {
	const serverUrl = useServerUrl();
	const authClient = useAuthClient();
	const cookie = authClient.getCookie();
	const baseUrl = serverUrl ?? CLOUD_URL;
	return useMemo(
		() => createContractRunner(baseUrl, cookie ? { Cookie: cookie } : {}),
		[baseUrl, cookie],
	);
}

export function useSystemConfig() {
	const runContract = useContractClient();
	return useQuery({
		queryKey: ["system-config"],
		queryFn: () => runContract((client) => client.system.config()),
	});
}
