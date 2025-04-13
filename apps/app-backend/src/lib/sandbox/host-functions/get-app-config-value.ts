import { appConfig } from "~/lib/config";
import {
	apiFailure,
	apiSuccess,
	type ConfigValueResult,
} from "~/lib/sandbox/types";

export const getAppConfigValue = async (
	key: unknown,
): Promise<ConfigValueResult> => {
	if (typeof key !== "string" || !key.trim()) {
		return apiFailure("getAppConfigValue expects a non-empty key string");
	}

	const trimmedKey = key.trim() as keyof typeof appConfig;

	if (!(trimmedKey in appConfig)) {
		return apiFailure(`Config key "${trimmedKey}" does not exist`);
	}

	const value = appConfig[trimmedKey];

	return apiSuccess(value ?? null);
};
