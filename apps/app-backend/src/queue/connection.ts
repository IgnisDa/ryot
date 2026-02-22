const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const getRedisConnection = () => {
	return {
		maxRetriesPerRequest: null,
		host: REDIS_URL.includes("://") ? new URL(REDIS_URL).hostname : "localhost",
		port: REDIS_URL.includes("://")
			? Number(new URL(REDIS_URL).port || 6379)
			: 6379,
	};
};
