import { apiFailure, apiSuccess } from "~/sandbox/types";

export const getUserConfigValue = (key: unknown) => {
	if (typeof key !== "string" || !key.trim())
		return apiFailure("getUserConfigValue expects a non-empty key string");

	const trimmedKey = key.trim();
	if (trimmedKey === "pageSize") return apiSuccess(20);

	return apiFailure(`User config key "${trimmedKey}" does not exist`);
};
