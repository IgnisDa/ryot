import {
	apiFailure,
	apiSuccess,
	type ConfigValueResult,
	type HostFunction,
} from "~/lib/sandbox/types";

export const getUserConfigValue: HostFunction<Record<string, never>> = async (
	_context,
	key,
): Promise<ConfigValueResult> => {
	if (typeof key !== "string" || !key.trim()) {
		return apiFailure("getUserConfigValue expects a non-empty key string");
	}

	const trimmedKey = key.trim();
	if (trimmedKey === "pageSize") {
		return apiSuccess(20);
	}

	return apiFailure(`User config key "${trimmedKey}" does not exist`);
};
