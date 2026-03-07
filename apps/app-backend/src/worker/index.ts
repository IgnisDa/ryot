import { type Runner, run } from "graphile-worker";
import { getWorkerPool, shutdownWorkerPool } from "./connection";
import { taskList } from "./runners";

let runner: Runner | null = null;

export const initializeWorker = async () => {
	if (runner) return runner;

	const pgPool = getWorkerPool();

	runner = await run({
		pgPool,
		taskList,
		concurrency: 5,
		noHandleSignals: true,
	});

	console.info("Graphile Worker initialized");
	return runner;
};

export const getRunner = () => {
	if (!runner)
		throw new Error("Worker not initialized. Call initializeWorker() first.");
	return runner;
};

export const shutdownWorker = async () => {
	try {
		if (runner) await runner.stop();
	} finally {
		runner = null;
		await shutdownWorkerPool();
		console.info("Graphile Worker shut down");
	}
};
