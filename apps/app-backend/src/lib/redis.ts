import Redis from "ioredis";
import { config } from "./config";

export const redis = new Redis(config.REDIS_URL, {
	lazyConnect: true,
	maxRetriesPerRequest: 3,
});

export const initializeRedis = async () => {
	await redis.connect();
	console.info("Redis client initialized");
};

export const shutdownRedis = async () => {
	await redis.quit();
	console.info("Redis client shut down");
};
