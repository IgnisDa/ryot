import { config } from "../config";

export const getRedisConnection = () => {
	const redisUrl = config.redisUrl;
	return {
		maxRetriesPerRequest: null,
		host: redisUrl.includes("://") ? new URL(redisUrl).hostname : "localhost",
		port: redisUrl.includes("://")
			? Number(new URL(redisUrl).port || 6379)
			: 6379,
	};
};
