import { getEntitySchemaById } from "~/modules/entity-schemas/read-service";

import type { HostFunction } from "../types";
import {
	mapServiceResult,
	requireStringArg,
	requireUserId,
	type UserHostFunctionContext,
} from "./shared";

export const createGetEntitySchemaHostFunction = (
	readEntitySchema: typeof getEntitySchemaById = getEntitySchemaById,
): HostFunction<UserHostFunctionContext> => {
	return async (context, entitySchemaId) => {
		const userId = requireUserId(context, "getEntitySchema");
		if (typeof userId !== "string") {
			return userId;
		}

		const resolvedEntitySchemaId = requireStringArg(
			entitySchemaId,
			"getEntitySchema",
			"entitySchemaId",
		);
		if (typeof resolvedEntitySchemaId !== "string") {
			return resolvedEntitySchemaId;
		}

		return mapServiceResult(
			await readEntitySchema({ userId, entitySchemaId: resolvedEntitySchemaId }),
		);
	};
};

export const getEntitySchema = createGetEntitySchemaHostFunction();
