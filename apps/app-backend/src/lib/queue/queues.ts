import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

const defaultJobOptions = {
	attempts: 1,
	removeOnFail: { age: 86400, count: 1000 },
	removeOnComplete: { age: 3600, count: 1000 },
};

export const createQueues = () => {
	const connection = getRedisConnection();
	const eventsQueue = new Queue("events", { connection, defaultJobOptions });
	const sandboxQueue = new Queue("sandbox", { connection, defaultJobOptions });
	const mediaQueue = new Queue("media", {
		connection,
		defaultJobOptions: {
			...defaultJobOptions,
			attempts: 3,
			backoff: { type: "exponential", delay: 5000 },
			removeOnComplete: { age: 86400, count: 1000 },
		},
	});
	const fitnessQueue = new Queue("fitness", {
		connection,
		defaultJobOptions: {
			...defaultJobOptions,
			attempts: 3,
			backoff: { type: "exponential", delay: 5000 },
		},
	});
	return { eventsQueue, fitnessQueue, mediaQueue, sandboxQueue };
};

export type Queues = ReturnType<typeof createQueues>;
