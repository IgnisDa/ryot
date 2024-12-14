import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

export const createQueues = () => {
	const connection = getRedisConnection();

	const exampleQueue = new Queue("example", { connection });

	return { exampleQueue };
};

export type Queues = ReturnType<typeof createQueues>;
