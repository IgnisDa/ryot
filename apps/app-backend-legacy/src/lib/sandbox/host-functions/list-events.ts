import { listEntityEvents, listEventsQuery } from "~/modules/events";

import { apiFailure, type HostFunction } from "../types";
import {
	formatIssues,
	mapServiceResult,
	requireUserId,
	type UserHostFunctionContext,
} from "./shared";

export const createListEventsHostFunction = (
	readEvents: typeof listEntityEvents = listEntityEvents,
): HostFunction<UserHostFunctionContext> => {
	return async (context, query) => {
		const userId = requireUserId(context, "listEvents");
		if (typeof userId !== "string") {
			return userId;
		}

		const parsed = listEventsQuery.safeParse(query);
		if (!parsed.success) {
			return apiFailure(formatIssues(parsed.error.issues));
		}

		return mapServiceResult(await readEvents({ ...parsed.data, userId }));
	};
};

export const listEvents = createListEventsHostFunction();
