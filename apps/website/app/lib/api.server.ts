import { type ContractPayload, type ContractProgram, runContract } from "@ryot/contract/client";
import type { UserId } from "@ryot/contract/schema/brands";

import { getServerVariables } from "./config.server";

const runAdmin = <A, E>(program: ContractProgram<A, E>) => {
	const serverVariables = getServerVariables();

	return runContract(program, {
		baseUrl: `${serverVariables.RYOT_BASE_URL}/api`,
		headers: { "Admin-Access-Token": serverVariables.SERVER_ADMIN_ACCESS_TOKEN },
	});
};

export const provisionUser = (payload: ContractPayload<"godMode", "provisionUser">) =>
	runAdmin((client) =>
		payload.provider === "oidc"
			? client.godMode.provisionUser({ payload })
			: client.godMode.provisionUser({ payload }),
	);

export const resetUserPassword = (userId: UserId) =>
	runAdmin((client) => client.godMode.resetUserPassword({ params: { userId } }));

export const setUserDisabled = (userId: UserId, disabled: boolean) =>
	runAdmin((client) =>
		client.godMode.setUserDisabled({ params: { userId }, payload: { disabled } }),
	);
