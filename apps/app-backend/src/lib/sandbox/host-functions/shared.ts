import type { ServiceResult } from "~/lib/result";
import { apiFailure, apiSuccess } from "~/lib/sandbox/types";

export type UserHostFunctionContext = {
	userId: string;
};

export const formatIssues = (issues: Array<{ message: string }>) =>
	issues.map((issue) => issue.message).join("; ");

export const mapServiceResult = <T, E extends string>(result: ServiceResult<T, E>) => {
	if ("error" in result) {
		return apiFailure(result.message);
	}

	return apiSuccess(result.data);
};

export const requireStringArg = (value: unknown, functionName: string, argumentName: string) => {
	if (typeof value !== "string" || !value.trim()) {
		return apiFailure(`${functionName} expects a non-empty ${argumentName} string`);
	}

	return value.trim();
};

export const requireUserId = (context: UserHostFunctionContext, functionName: string) => {
	if (typeof context.userId !== "string" || !context.userId.trim()) {
		return apiFailure(`${functionName} requires a non-empty userId in context`);
	}

	return context.userId.trim();
};
