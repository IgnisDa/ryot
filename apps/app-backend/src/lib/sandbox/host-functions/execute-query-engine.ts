import { extractErrorMessage } from "@ryot/ts-utils/error";

import { apiFailure, apiSuccess, type HostFunction } from "~/lib/sandbox/types";
import { QueryEngineNotFoundError, QueryEngineValidationError } from "~/lib/views/errors";
import { prepareAndExecute, queryEngineRequestSchema } from "~/modules/query-engine";

import { formatIssues, requireUserId, type UserHostFunctionContext } from "./shared";

export const createExecuteQueryEngineHostFunction = (
	executeQuery: typeof prepareAndExecute = prepareAndExecute,
): HostFunction<UserHostFunctionContext> => {
	return async (context, request) => {
		const userId = requireUserId(context, "executeQueryEngine");
		if (typeof userId !== "string") {
			return userId;
		}

		const parsed = queryEngineRequestSchema.safeParse(request);
		if (!parsed.success) {
			return apiFailure(formatIssues(parsed.error.issues));
		}

		try {
			return apiSuccess(await executeQuery({ userId, request: parsed.data }));
		} catch (error) {
			if (
				error instanceof QueryEngineNotFoundError ||
				error instanceof QueryEngineValidationError
			) {
				return apiFailure(error.message);
			}

			return apiFailure(extractErrorMessage(error, "executeQueryEngine failed"));
		}
	};
};

export const executeQueryEngine = createExecuteQueryEngineHostFunction();
