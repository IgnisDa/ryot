import type { ProvisionUserBody } from "@ryot-app/instance-contract/account-admin";
import {
	type InstanceAdminClient,
	makeInstanceAdminClient,
} from "@ryot-app/instance-contract/client";
import type { UserId } from "@ryot-app/instance-contract/user";
import { Effect } from "effect";

import { getServerVariables } from "./config.server";
import { WebsiteFailure } from "./effect.server";

const runAdmin = <A, E>(program: (client: InstanceAdminClient) => Effect.Effect<A, E>) => {
	const serverVariables = getServerVariables();
	return makeInstanceAdminClient(
		`${serverVariables.RYOT_BASE_URL}/api`,
		serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
	).pipe(
		Effect.flatMap(program),
		Effect.mapError((cause) => new WebsiteFailure({ cause })),
	);
};

export const provisionUser = (payload: ProvisionUserBody) =>
	runAdmin((client) => client.instanceAdmin.provisionUser({ payload }));

export const resetUserPassword = (userId: UserId) =>
	runAdmin((client) => client.instanceAdmin.resetUserPassword({ params: { userId } }));

export const setUserDisabled = (userId: UserId, disabled: boolean) =>
	runAdmin((client) =>
		client.instanceAdmin.setUserDisabled({ params: { userId }, payload: { disabled } }),
	);
