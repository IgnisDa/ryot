import { type Job, Worker } from "bullmq";

import { getRedisConnection } from "~/lib/queue/connection";
import { onWorkerError } from "~/lib/queue/utils";

import { importRunJobData, importRunJobName } from "./jobs";
import { processImportJob } from "./runtime/processor";

const processImportQueueJob = async (job: Job, token?: string): Promise<void> => {
	if (job.name === importRunJobName) {
		const parsed = importRunJobData.safeParse(job.data);
		if (!parsed.success) {
			throw new Error("Import run job payload is invalid");
		}
		await processImportJob({ job, token, ...parsed.data });
		return;
	}
	throw new Error(`Unsupported import queue job: ${job.name}`);
};

export const createImportWorker = () => {
	const worker = new Worker("import", processImportQueueJob, {
		concurrency: 1,
		connection: getRedisConnection(),
	});
	worker.on("error", onWorkerError("import"));
	return worker;
};
