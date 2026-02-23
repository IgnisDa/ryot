import { createQueues, type Queues } from "./queues";
import { createWorkers, type Workers } from "./workers";

let queues: Queues | null = null;
let workers: Workers | null = null;

export const initializeQueues = async () => {
	queues = createQueues();
	console.info("Queues initialized");
	return queues;
};

export const initializeWorkers = async () => {
	workers = createWorkers();
	console.info("Workers initialized");
	return workers;
};

export const getQueues = () => {
	if (!queues)
		throw new Error("Queues not initialized. Call initializeQueues() first.");
	return queues;
};

export const getWorkers = () => {
	if (!workers)
		throw new Error("Workers not initialized. Call initializeWorkers() first.");
	return workers;
};

export const shutdownQueues = async () => {
	if (queues) {
		await queues.sandboxScriptQueue.close();
		queues = null;
		console.info("Queues shut down");
	}
};

export const shutdownWorkers = async () => {
	if (workers) {
		await workers.sandboxScriptWorker.close();
		workers = null;
		console.info("Workers shut down");
	}
};
