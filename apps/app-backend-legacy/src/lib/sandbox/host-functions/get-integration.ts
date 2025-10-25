import { getIntegration as readIntegrationForUser } from "~/modules/integrations/service";

import type { HostFunction } from "../types";
import {
	mapServiceResult,
	requireStringArg,
	requireUserId,
	type UserHostFunctionContext,
} from "./shared";

export const createGetIntegrationHostFunction = (
	readIntegration: typeof readIntegrationForUser = readIntegrationForUser,
): HostFunction<UserHostFunctionContext> => {
	return async (context, integrationId) => {
		const userId = requireUserId(context, "getIntegration");
		if (typeof userId !== "string") {
			return userId;
		}

		const resolvedIntegrationId = requireStringArg(
			integrationId,
			"getIntegration",
			"integrationId",
		);
		if (typeof resolvedIntegrationId !== "string") {
			return resolvedIntegrationId;
		}

		return mapServiceResult(await readIntegration({ userId, id: resolvedIntegrationId }));
	};
};

export const getIntegration = createGetIntegrationHostFunction();
