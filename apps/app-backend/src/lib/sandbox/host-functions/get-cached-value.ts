import { extractErrorMessage } from "@ryot/ts-utils/error";

import { redis } from "~/lib/redis";
import { redisKeys, redisValues } from "~/lib/redis-keys";
import {
	apiFailure,
	apiSuccess,
	type CachedValueContext,
	type CachedValueResult,
	type HostFunction,
} from "~/lib/sandbox/types";

export const getCachedValue: HostFunction<CachedValueContext> = async (
	context,
	key,
): Promise<CachedValueResult> => {
	if (typeof context.scriptId !== "string" || !context.scriptId.trim()) {
		return apiFailure("getCachedValue requires a non-empty scriptId in context");
	}

	if (typeof key !== "string" || !key.trim()) {
		return apiFailure("getCachedValue expects a non-empty key string");
	}

	const trimmedKey = key.trim();

	try {
		const cached = await redis.get(redisKeys.sandbox.cache(context.scriptId, trimmedKey));
		if (cached === null) {
			return apiSuccess(null);
		}

		const parsed = redisValues.sandbox.cache.safeParse(cached);
		if (!parsed.success) {
			return apiFailure("getCachedValue: stored value is not valid JSON");
		}

		return apiSuccess(parsed.data);
	} catch (error) {
		return apiFailure(extractErrorMessage(error, "getCachedValue failed"));
	}
};
