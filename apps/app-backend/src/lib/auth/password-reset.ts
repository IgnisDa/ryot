import { redis } from "~/lib/redis";
import { redisKeys, redisValues } from "~/lib/redis-keys";

export const storePendingReset = async (email: string, correlationId: string) => {
	return (
		(await redis.set(
			redisKeys.godMode.pendingReset(email),
			redisValues.godMode.pendingReset.stringify(correlationId),
			"EX",
			60,
			"NX",
		)) === "OK"
	);
};

export const getPendingCorrelationId = async (email: string): Promise<string | null> => {
	return redisValues.godMode.pendingReset.parseNullable(
		await redis.get(redisKeys.godMode.pendingReset(email)),
	);
};

export const clearPendingReset = async (email: string, correlationId?: string) => {
	const key = redisKeys.godMode.pendingReset(email);
	if (!correlationId) {
		await redis.del(key);
		return;
	}

	await redis.eval(
		"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
		1,
		key,
		redisValues.godMode.pendingReset.stringify(correlationId),
	);
};
