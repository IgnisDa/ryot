import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

export const createQueues = () => {
	const connection = getRedisConnection();
	const sandboxScriptQueue = new Queue("sandboxScript", { connection });
	return { sandboxScriptQueue };
};

export type Queues = ReturnType<typeof createQueues>;
