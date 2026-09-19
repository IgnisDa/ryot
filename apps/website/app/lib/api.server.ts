import {
	type ContractPayload,
	type ContractProgram,
	makeContractClient,
} from "@ryot-app/contract/client";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { getServerVariables } from "./config.server";
import { WebsiteFailure } from "./effect.server";

const runAdmin = <A, E>(program: ContractProgram<A, E>) => {
	const serverVariables = getServerVariables();
	return makeContractClient(`${serverVariables.RYOT_BASE_URL}/api`, {
		"Admin-Access-Token": serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
	}).pipe(
		Effect.flatMap(program),
		Effect.mapError((cause) => new WebsiteFailure({ cause })),
	);
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
