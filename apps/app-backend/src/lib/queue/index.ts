import { shutdownQueueRedisConnection } from "./connection";
import { createQueues, type Queues } from "./queues";

let queues: Queues | null = null;

export const initializeQueues = async () => {
	queues = createQueues();
	await Promise.all([
		queues.entityQueue.waitUntilReady(),
		queues.eventsQueue.waitUntilReady(),
		queues.importQueue.waitUntilReady(),
		queues.sandboxQueue.waitUntilReady(),
	]);
	console.info("Queues initialized");
	return queues;
};

export const getQueues = () => {
	if (!queues) {
		throw new Error("Queues not initialized. Call initializeQueues() first.");
	}
	return queues;
};

export const shutdownQueues = async () => {
	if (queues) {
		await Promise.all([
			queues.entityQueue.close(),
			queues.eventsQueue.close(),
			queues.importQueue.close(),
			queues.sandboxQueue.close(),
		]);
		queues = null;
		await shutdownQueueRedisConnection();
		console.info("Queues shut down");
	}
};
