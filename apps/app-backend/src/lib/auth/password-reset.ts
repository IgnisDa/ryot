import { redis } from "~/lib/redis";

const PENDING_KEY_PREFIX = "god-mode:pending:";

const getPendingResetKey = (email: string) => `${PENDING_KEY_PREFIX}${email}`;

export const storePendingReset = async (email: string, correlationId: string) => {
	return (await redis.set(getPendingResetKey(email), correlationId, "EX", 60, "NX")) === "OK";
};

export const getPendingCorrelationId = async (email: string): Promise<string | null> => {
	return redis.get(getPendingResetKey(email));
};

export const clearPendingReset = async (email: string, correlationId?: string) => {
	const key = getPendingResetKey(email);
	if (!correlationId) {
		await redis.del(key);
		return;
	}

	await redis.eval(
		"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
		1,
		key,
		correlationId,
	);
};
