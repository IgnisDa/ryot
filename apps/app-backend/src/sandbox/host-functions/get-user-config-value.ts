import { apiFailure, apiSuccess, type ConfigValueResult } from "../types";

export const getUserConfigValue = (key: unknown): ConfigValueResult => {
	if (typeof key !== "string" || !key.trim())
		return apiFailure("getUserConfigValue expects a non-empty key string");

	const trimmedKey = key.trim();
	if (trimmedKey === "pageSize") return apiSuccess(20);

	return apiFailure(`User config key "${trimmedKey}" does not exist`);
};
