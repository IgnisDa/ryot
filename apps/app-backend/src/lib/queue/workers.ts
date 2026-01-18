import { type Job, Worker } from "bullmq";
import { getSandboxService } from "~/lib/sandbox";
import { sandboxRunJobData, sandboxRunJobName } from "~/lib/sandbox/jobs";
import {
	createEvents,
	createEventsJobData,
	createEventsJobName,
} from "~/modules/events";
import { getRedisConnection } from "./connection";

const processCreateEventsJob = async (job: Job) => {
	const parsed = createEventsJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Create events payload is invalid");
	}

	const result = await createEvents(parsed.data);
	if ("error" in result) {
		throw new Error(result.message);
	}

	return result.data;
};

const processEventsJob = async (job: Job) => {
	if (job.name === createEventsJobName) {
		return processCreateEventsJob(job);
	}

	throw new Error(`Unsupported events job: ${job.name}`);
};

const processSandboxRunJob = async (job: Job) => {
	const parsed = sandboxRunJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Sandbox run payload is invalid");
	}

	const sandbox = getSandboxService();
	return sandbox.executeQueuedRun(parsed.data);
};

const processSandboxScriptJob = async (job: Job) => {
	if (job.name === sandboxRunJobName) {
		return processSandboxRunJob(job);
	}

	throw new Error(`Unsupported sandbox script job: ${job.name}`);
};

const onWorkerError = (name: string) => (err: Error) => {
	console.error(`Worker error [${name}]:`, err);
};

export const createWorkers = () => {
	const connection = getRedisConnection();

	const eventsWorker = new Worker("events", processEventsJob, { connection });
	eventsWorker.on("error", onWorkerError("events"));

	const sandboxScriptWorker = new Worker(
		"sandboxScript",
		processSandboxScriptJob,
		{ connection, concurrency: 5 },
	);
	sandboxScriptWorker.on("error", onWorkerError("sandboxScript"));

	return { eventsWorker, sandboxScriptWorker };
};

export type Workers = ReturnType<typeof createWorkers>;
