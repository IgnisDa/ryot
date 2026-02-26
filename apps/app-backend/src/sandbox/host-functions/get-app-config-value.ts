import { type Config, config } from "~/lib/config";
import {
	apiFailure,
	apiSuccess,
	type ConfigValueResult,
} from "~/sandbox/types";

const isConfigKey = (key: string): key is keyof Config =>
	Object.hasOwn(config, key);

export const getAppConfigValue = (key: unknown): ConfigValueResult => {
	if (typeof key !== "string" || !key.trim())
		return apiFailure("getAppConfigValue expects a non-empty key string");

	const trimmedKey = key.trim();
	if (!isConfigKey(trimmedKey))
		return apiFailure(`Config key "${trimmedKey}" does not exist`);

	return apiSuccess(config[trimmedKey]);
};
