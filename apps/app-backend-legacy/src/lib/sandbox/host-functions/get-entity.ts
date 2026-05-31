import { getEntityDetail } from "~/modules/entities";

import type { HostFunction } from "../types";
import {
	mapServiceResult,
	requireStringArg,
	requireUserId,
	type UserHostFunctionContext,
} from "./shared";

export const createGetEntityHostFunction = (
	getEntity: typeof getEntityDetail = getEntityDetail,
): HostFunction<UserHostFunctionContext> => {
	return async (context, entityId) => {
		const userId = requireUserId(context, "getEntity");
		if (typeof userId !== "string") {
			return userId;
		}

		const resolvedEntityId = requireStringArg(entityId, "getEntity", "entityId");
		if (typeof resolvedEntityId !== "string") {
			return resolvedEntityId;
		}

		return mapServiceResult(await getEntity({ userId, entityId: resolvedEntityId }));
	};
};

export const getEntity = createGetEntityHostFunction();
