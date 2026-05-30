import { extractErrorMessage } from "@ryot/ts-utils/error";

import { redis } from "~/lib/redis";
import { redisKeys, redisValues } from "~/lib/redis-keys";
import {
	apiFailure,
	apiSuccess,
	type CachedValueContext,
	type ClaimCachedValueResult,
	type HostFunction,
} from "~/lib/sandbox/types";

export const claimCachedValue: HostFunction<CachedValueContext> = async (
	context,
	key,
	value,
	ttlSeconds,
): Promise<ClaimCachedValueResult> => {
	if (typeof context.scriptId !== "string" || !context.scriptId.trim()) {
		return apiFailure("claimCachedValue requires a non-empty scriptId in context");
	}

	if (typeof key !== "string" || !key.trim()) {
		return apiFailure("claimCachedValue expects a non-empty key string");
	}

	if (typeof ttlSeconds !== "number" || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
		return apiFailure("claimCachedValue expects a positive integer ttlSeconds");
	}

	const trimmedKey = key.trim();
	const redisKey = redisKeys.sandbox.cache(context.scriptId, trimmedKey);

	let serialized: string;
	try {
		serialized = redisValues.sandbox.cache.stringify(value);
	} catch {
		return apiFailure("claimCachedValue value must be JSON-serializable");
	}

	try {
		const setResult = await redis.set(redisKey, serialized, "EX", ttlSeconds, "NX");

		if (setResult !== null) {
			return apiSuccess({ claimed: true });
		}

		const existing = await redis.get(redisKey);
		if (existing === null) {
			return apiSuccess({ claimed: false, value: null });
		}

		const parsed = redisValues.sandbox.cache.safeParse(existing);
		if (!parsed.success) {
			return apiSuccess({ claimed: false, value: null });
		}

		return apiSuccess({ claimed: false, value: parsed.data });
	} catch (error) {
		return apiFailure(extractErrorMessage(error, "claimCachedValue failed"));
	}
};
