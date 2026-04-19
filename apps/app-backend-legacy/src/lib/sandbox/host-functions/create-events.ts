import { createEventBulkBody, enqueueEventsForUser } from "~/modules/events";

import { apiFailure, type HostFunction } from "../types";
import {
	formatIssues,
	mapServiceResult,
	requireUserId,
	type UserHostFunctionContext,
} from "./shared";

export const createCreateEventsHostFunction = (
	enqueueEvents: typeof enqueueEventsForUser = enqueueEventsForUser,
): HostFunction<UserHostFunctionContext> => {
	return async (context, body) => {
		const userId = requireUserId(context, "createEvents");
		if (typeof userId !== "string") {
			return userId;
		}

		const parsed = createEventBulkBody.safeParse(body);
		if (!parsed.success) {
			return apiFailure(formatIssues(parsed.error.issues));
		}

		return mapServiceResult(await enqueueEvents({ userId, body: parsed.data }));
	};
};

export const createEvents = createCreateEventsHostFunction();
