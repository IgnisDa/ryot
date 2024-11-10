import { type Job, Worker } from "bullmq";
import { getSandboxService } from "../sandbox";
import { sandboxRunJobData, sandboxRunJobName } from "../sandbox/jobs";
import { getRedisConnection } from "./connection";

const processSandboxRunJob = async (job: Job) => {
	const parsed = sandboxRunJobData.safeParse(job.data);
	if (!parsed.success) throw new Error("Sandbox run payload is invalid");

	const sandbox = getSandboxService();
	return sandbox.executeQueuedRun(parsed.data);
};

const processSandboxScriptJob = async (job: Job) => {
	if (job.name === sandboxRunJobName) return processSandboxRunJob(job);

	throw new Error(`Unsupported sandbox script job: ${job.name}`);
};

export const createWorkers = () => {
	const connection = getRedisConnection();

	const sandboxScriptWorker = new Worker(
		"sandboxScript",
		processSandboxScriptJob,
		{ connection },
	);

	return { sandboxScriptWorker };
};

export type Workers = ReturnType<typeof createWorkers>;
