import type { ConnectionOptions } from "bullmq";
import { config } from "../config";

export const getRedisConnection = () => {
	const redisUrl = config.REDIS_URL;
	return { url: redisUrl, maxRetriesPerRequest: null } as ConnectionOptions;
};
