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

export const setCachedValue: HostFunction<CachedValueContext> = async (
	context,
	key,
	value,
	expiry,
): Promise<CachedValueResult> => {
	if (typeof context.scriptId !== "string" || !context.scriptId.trim()) {
		return apiFailure("setCachedValue requires a non-empty scriptId in context");
	}

	if (typeof key !== "string" || !key.trim()) {
		return apiFailure("setCachedValue expects a non-empty key string");
	}

	const trimmedKey = key.trim();

	if (typeof expiry !== "number" || !Number.isInteger(expiry) || expiry <= 0) {
		return apiFailure("setCachedValue expects a positive integer expiry in seconds");
	}

	let serialized: string;
	try {
		serialized = redisValues.sandbox.cache.stringify(value);
	} catch {
		return apiFailure("setCachedValue value must be JSON-serializable");
	}

	try {
		await redis.setex(redisKeys.sandbox.cache(context.scriptId, trimmedKey), expiry, serialized);
		return apiSuccess(null);
	} catch (error) {
		return apiFailure(extractErrorMessage(error, "setCachedValue failed"));
	}
};
