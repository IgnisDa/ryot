import { eq } from "drizzle-orm";
import { db } from "~/db";
import { appConfig } from "~/db/schema";
import { isAppConfigKey } from "~/lib/app-config";
import {
	apiFailure,
	apiSuccess,
	type ConfigValueResult,
} from "~/sandbox/types";

export const getAppConfigValue = async (
	key: unknown,
): Promise<ConfigValueResult> => {
	if (typeof key !== "string" || !key.trim())
		return apiFailure("getAppConfigValue expects a non-empty key string");

	const trimmedKey = key.trim();
	if (!isAppConfigKey(trimmedKey))
		return apiFailure(`Config key "${trimmedKey}" does not exist`);

	const [foundConfig] = await db
		.select({ value: appConfig.value })
		.from(appConfig)
		.where(eq(appConfig.key, trimmedKey))
		.limit(1);

	if (!foundConfig)
		return apiFailure(`Config key "${trimmedKey}" does not exist`);

	return apiSuccess(foundConfig.value);
};
