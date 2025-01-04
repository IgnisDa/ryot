import type { ConnectionOptions } from "bullmq";
import Redis from "ioredis";
import { config } from "~/lib/config";

let sharedRedisConnection: Redis | null = null;

export const getRedisConnection = () => {
	if (sharedRedisConnection) return sharedRedisConnection as ConnectionOptions;

	const redisUrl = config.REDIS_URL;
	sharedRedisConnection = new Redis(redisUrl, {
		maxRetriesPerRequest: null,
	});

	return sharedRedisConnection as ConnectionOptions;
};

export const shutdownQueueRedisConnection = async () => {
	if (!sharedRedisConnection) return;

	await sharedRedisConnection.quit();
	sharedRedisConnection = null;
};
