import { listEventSchemas as listEventSchemasForUser } from "~/modules/event-schemas/read-service";

import type { HostFunction } from "../types";
import {
	mapServiceResult,
	requireStringArg,
	requireUserId,
	type UserHostFunctionContext,
} from "./shared";

export const createListEventSchemasHostFunction = (
	readEventSchemas: typeof listEventSchemasForUser = listEventSchemasForUser,
): HostFunction<UserHostFunctionContext> => {
	return async (context, entitySchemaId) => {
		const userId = requireUserId(context, "listEventSchemas");
		if (typeof userId !== "string") {
			return userId;
		}

		const resolvedEntitySchemaId = requireStringArg(
			entitySchemaId,
			"listEventSchemas",
			"entitySchemaId",
		);
		if (typeof resolvedEntitySchemaId !== "string") {
			return resolvedEntitySchemaId;
		}

		return mapServiceResult(
			await readEventSchemas({ userId, entitySchemaId: resolvedEntitySchemaId }),
		);
	};
};

export const listEventSchemas = createListEventSchemasHostFunction();
