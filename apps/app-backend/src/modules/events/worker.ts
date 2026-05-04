import { type Job, Worker } from "bullmq";

import { getRedisConnection } from "~/lib/queue/connection";
import { onWorkerError } from "~/lib/queue/utils";

import { createEventsJobData, createEventsJobName } from "./jobs";
import { createEvents, processEventSchemaTriggers } from "./service";

const processCreateEventsJob = async (job: Job) => {
	const parsed = createEventsJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Create events payload is invalid");
	}

	const result = await createEvents(parsed.data);
	if ("error" in result) {
		throw new Error(result.message);
	}

	await processEventSchemaTriggers({
		userId: parsed.data.userId,
		createdEvents: result.data.createdEvents,
	});

	return { count: result.data.count };
};

const processEventsJob = async (job: Job) => {
	if (job.name === createEventsJobName) {
		return processCreateEventsJob(job);
	}

	throw new Error(`Unsupported events job: ${job.name}`);
};

export const createEventsWorker = () => {
	const worker = new Worker("events", processEventsJob, {
		connection: getRedisConnection(),
	});
	worker.on("error", onWorkerError("events"));
	return worker;
};
