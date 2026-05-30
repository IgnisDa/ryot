import type { AppConfigPath } from "~/lib/config";
import { appConfigEnvIndex, appConfigPathIndex } from "~/lib/config";
import {
	apiFailure,
	apiSuccess,
	type ConfigValueResult,
	type HostFunction,
} from "~/lib/sandbox/types";

export const getAppConfigValue: HostFunction<Record<string, never>> = (
	_context,
	key,
): Promise<ConfigValueResult> => {
	if (typeof key !== "string" || !key.trim()) {
		return Promise.resolve(apiFailure("getAppConfigValue expects a non-empty key string"));
	}

	const trimmedKey = key.trim();

	if (!(trimmedKey in appConfigPathIndex)) {
		return Promise.resolve(apiFailure(`Config key "${trimmedKey}" does not exist`));
	}

	// oxlint-disable-next-line no-unsafe-type-assertion
	const envKey = appConfigPathIndex[trimmedKey as AppConfigPath];
	const value = appConfigEnvIndex[envKey];

	return Promise.resolve(apiSuccess(value ?? null));
};
