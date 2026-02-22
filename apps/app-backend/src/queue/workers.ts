import { type Job, Worker } from "bullmq";
import { getRedisConnection } from "./connection";

type ExampleJobData = {
	message: string;
};

const processExampleJob = async (job: Job<ExampleJobData>) => {
	console.info(`Processing example job ${job.id}:`, job.data.message);
	await new Promise((resolve) => setTimeout(resolve, 1000));
	console.info(`Completed example job ${job.id}`);
};

export const createWorkers = () => {
	const connection = getRedisConnection();

	const exampleWorker = new Worker("example", processExampleJob, {
		connection,
	});

	exampleWorker.on("completed", (job) => {
		console.info(`Job ${job.id} completed`);
	});

	exampleWorker.on("failed", (job, err) => {
		console.error(`Job ${job?.id} failed:`, err);
	});

	return { exampleWorker };
};

export type Workers = ReturnType<typeof createWorkers>;
