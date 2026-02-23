import { Queue, QueueEvents } from "bullmq";
import { getRedisConnection } from "./connection";

export const createQueues = () => {
	const connection = getRedisConnection();
	const sandboxScriptQueue = new Queue("sandboxScript", {
		connection,
		defaultJobOptions: {
			removeOnFail: { age: 3600, count: 1000 },
			removeOnComplete: { age: 600, count: 1000 },
		},
	});
	const sandboxScriptQueueEvents = new QueueEvents("sandboxScript", {
		connection,
	});
	return { sandboxScriptQueue, sandboxScriptQueueEvents };
};

export type Queues = ReturnType<typeof createQueues>;
