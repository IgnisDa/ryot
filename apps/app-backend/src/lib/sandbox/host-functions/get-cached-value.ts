import { redis } from "~/lib/redis";
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
		return apiFailure(
			"getCachedValue requires a non-empty scriptId in context",
		);
	}

	if (typeof key !== "string" || !key.trim()) {
		return apiFailure("getCachedValue expects a non-empty key string");
	}

	try {
		const cached = await redis.get(
			`sandbox:cache:${context.scriptId}:${key.trim()}`,
		);
		if (cached === null) {
			return apiSuccess(null);
		}
		try {
			return apiSuccess(JSON.parse(cached));
		} catch {
			return apiFailure("getCachedValue: stored value is not valid JSON");
		}
	} catch (error) {
		return apiFailure(
			error instanceof Error ? error.message : "getCachedValue failed",
		);
	}
};
