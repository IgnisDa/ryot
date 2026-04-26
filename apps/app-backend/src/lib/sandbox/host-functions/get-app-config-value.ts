import { appConfigEnvIndex } from "~/lib/config";
import {
	apiFailure,
	apiSuccess,
	type ConfigValueResult,
	type HostFunction,
} from "~/lib/sandbox/types";

export const getAppConfigValue: HostFunction<Record<string, never>> = async (
	_context,
	key,
): Promise<ConfigValueResult> => {
	if (typeof key !== "string" || !key.trim()) {
		return apiFailure("getAppConfigValue expects a non-empty key string");
	}

	const trimmedKey = key.trim();

	if (!(trimmedKey in appConfigEnvIndex)) {
		return apiFailure(`Config key "${trimmedKey}" does not exist`);
	}

	const value = appConfigEnvIndex[trimmedKey as keyof typeof appConfigEnvIndex];

	return apiSuccess(value ?? null);
};
