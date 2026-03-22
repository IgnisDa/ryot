import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

export const createQueues = () => {
	const connection = getRedisConnection();
	const sandboxScriptQueue = new Queue("sandboxScript", {
		connection,
		defaultJobOptions: {
			attempts: 1,
			removeOnFail: { age: 86400, count: 1000 },
			removeOnComplete: { age: 3600, count: 1000 },
		},
	});
	return { sandboxScriptQueue };
};

export type Queues = ReturnType<typeof createQueues>;
