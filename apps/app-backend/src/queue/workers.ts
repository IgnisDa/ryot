import { type Job, Worker } from "bullmq";
import {
	entitySchemaSearchJobData,
	entitySchemaSearchJobName,
	schemaSearchResponse,
} from "../entity-schema-search";
import { getSandboxService } from "../sandbox";
import { getRedisConnection } from "./connection";

const processEntitySchemaSearchJob = async (job: Job) => {
	const parsed = entitySchemaSearchJobData.safeParse(job.data);
	if (!parsed.success) throw new Error("Search job payload is invalid");

	const sandbox = getSandboxService();
	const result = await sandbox.run({
		code: parsed.data.scriptCode,
		context: {
			page: parsed.data.page,
			query: parsed.data.query,
			schemaSlug: parsed.data.schemaSlug,
		},
	});

	if (!result.success) {
		let errorMessage = "Search script execution failed";
		if (result.error) errorMessage = `${errorMessage}: ${result.error}`;
		if (result.logs) errorMessage = `${errorMessage}\n${result.logs}`;
		throw new Error(errorMessage);
	}

	const parsedResult = schemaSearchResponse.safeParse(result.value);
	if (!parsedResult.success)
		throw new Error("Search script returned invalid payload");

	return parsedResult.data;
};

const processSandboxScriptJob = async (job: Job) => {
	if (job.name === entitySchemaSearchJobName)
		return processEntitySchemaSearchJob(job);

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
