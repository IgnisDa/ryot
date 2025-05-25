import { type Job, Worker } from "bullmq";
import { getRedisConnection } from "~/lib/queue/connection";
import { onWorkerError } from "~/lib/queue/utils";
import { getSandboxService } from "./index";
import { sandboxRunJobData, sandboxRunJobName } from "./jobs";

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

export const createSandboxScriptWorker = () => {
	const worker = new Worker("sandboxScript", processSandboxScriptJob, {
		concurrency: 5,
		connection: getRedisConnection(),
	});
	worker.on("error", onWorkerError("sandboxScript"));
	return worker;
};
