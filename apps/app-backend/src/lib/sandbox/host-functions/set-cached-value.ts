import { redis } from "~/lib/redis";
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
		return apiFailure(
			"setCachedValue requires a non-empty scriptId in context",
		);
	}

	if (typeof key !== "string" || !key.trim()) {
		return apiFailure("setCachedValue expects a non-empty key string");
	}

	if (typeof expiry !== "number" || !Number.isInteger(expiry) || expiry <= 0) {
		return apiFailure(
			"setCachedValue expects a positive integer expiry in seconds",
		);
	}

	let serialized: string;
	try {
		const result = JSON.stringify(value);
		if (result === undefined) {
			return apiFailure("setCachedValue value must be JSON-serializable");
		}
		serialized = result;
	} catch {
		return apiFailure("setCachedValue value must be JSON-serializable");
	}

	try {
		await redis.setex(
			`sandbox:cache:${context.scriptId}:${key.trim()}`,
			expiry,
			serialized,
		);
		return apiSuccess(null);
	} catch (error) {
		return apiFailure(
			error instanceof Error ? error.message : "setCachedValue failed",
		);
	}
};
