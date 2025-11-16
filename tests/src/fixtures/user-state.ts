import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";

type MergeUserStateBody = ContractPayload<"userState", "mergeUserState">;
type MergeUserStateData = ContractSuccess<"userState", "mergeUserState">;

export async function mergeUserState(
	client: Client,
	payload: MergeUserStateBody,
): Promise<MergeUserStateData> {
	return client.run((c) => c.userState.mergeUserState({ payload }));
}
