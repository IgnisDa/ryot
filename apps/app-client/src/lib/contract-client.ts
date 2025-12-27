import { runContract, type ContractClient, type RequestHeaders } from "@ryot/contract/client";
import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { useMemo } from "react";

import { useAuthClient, useServerUrl } from "@/lib/atoms";
import { CLOUD_URL } from "@/lib/server";

export type { ContractClient, ContractSuccess } from "@ryot/contract/client";

export type ContractRunner = <A, E>(
	run: (client: ContractClient) => Effect.Effect<A, E>,
) => Promise<A>;

export function createContractRunner(
	serverUrl: string,
	headers: RequestHeaders = {},
): ContractRunner {
	return (run) => runContract(run, { baseUrl: `${serverUrl}/api`, headers, credentials: "include" });
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
