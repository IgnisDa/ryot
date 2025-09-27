import { z } from "@hono/zod-openapi";
import { type Job, Worker } from "bullmq";

import { sha1Hex } from "~/lib/bun";
import { getQueues } from "~/lib/queue";
import { getRedisConnection } from "~/lib/queue/connection";
import { onWorkerError } from "~/lib/queue/utils";
import {
	getSandboxChildRunResult,
	queueSandboxChildRun,
	waitForSandboxChildRun,
} from "~/lib/sandbox/child-run";
import {
	getBuiltinEntitySchemaBySandboxScriptId,
	getBuiltinEntitySchemaBySlug,
} from "~/modules/entity-schemas";
import { getBuiltinRelationshipSchemaBySlug } from "~/modules/relationship-schemas";
import { getBuiltinSandboxScriptBySlug, getSandboxScriptForUser } from "~/modules/sandbox";

import {
	entityImportJobData,
	entityImportJobName,
	entityImportWaitingForSandboxStep,
	entityPreloadImportJobName,
	entityPreloadJobData,
	entityPreloadJobName,
	entityPreloadWaitingForSandboxStep,
} from "./jobs";
import {
	type EntityPopulationDeps,
	entityPopulationDeps,
	populateGlobalEntity,
} from "./population";
import {
	createGlobalEntity,
	findGlobalEntityByExternalId,
	getEntitySchemaScopeForUser,
	updateGlobalEntityById,
} from "./repository";
import { ensureEntityInLibrary, writeEntityRelationship } from "./service";

const entitySearchResultSchema = z.object({
	items: z.array(z.object({ externalId: z.string().min(1) })),
	details: z.object({
		nextPage: z.number().int().positive().nullable().optional(),
	}),
});

export type EntityImportWorkerDeps = EntityPopulationDeps & {
	ensureEntityInLibrary: typeof ensureEntityInLibrary;
	getSandboxScriptForUser: typeof getSandboxScriptForUser;
	getBuiltinEntitySchemaBySlug: typeof getBuiltinEntitySchemaBySlug;
	addEntityQueueJob: (input: {
		name: string;
		jobId?: string;
		payload: Record<string, unknown>;
	}) => Promise<void>;
};

const addEntityQueueJob: EntityImportWorkerDeps["addEntityQueueJob"] = async (input) => {
	await getQueues().entityQueue.add(
		input.name,
		input.payload,
		input.jobId ? { jobId: input.jobId } : {},
	);
};

const entityImportWorkerDeps: EntityImportWorkerDeps = {
	...entityPopulationDeps,
	addEntityQueueJob,
	ensureEntityInLibrary,
	getSandboxScriptForUser,
	getBuiltinEntitySchemaBySlug,
	// re-declare the shared deps explicitly so the spread above is clearly typed
	createGlobalEntity,
	updateGlobalEntityById,
	writeEntityRelationship,
	getEntitySchemaScopeForUser,
	findGlobalEntityByExternalId,
	getBuiltinSandboxScriptBySlug,
	getBuiltinRelationshipSchemaBySlug,
	getBuiltinEntitySchemaBySandboxScriptId,
};

const processEntityPopulationJob = async (
	job: Job,
	token?: string,
	deps: EntityImportWorkerDeps = entityImportWorkerDeps,
) => {
	const parsed = entityImportJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Entity import job payload is invalid");
	}

	const { userId, scriptId, externalId, entitySchemaId } = parsed.data;
	const step = parsed.data.step;

	if (!step) {
		const script = await deps.getSandboxScriptForUser({ userId, scriptId });
		if (!script) {
			throw new Error("Sandbox script not found");
		}
	}

	const sandboxAlreadyQueued = step === entityImportWaitingForSandboxStep;
	const sandboxChildJobId = `${job.id}_sandbox`;
	const updatedJobData = { ...parsed.data, step: entityImportWaitingForSandboxStep };

	const result = await populateGlobalEntity(
		job,
		token,
		{
			userId,
			scriptId,
			externalId,
			entitySchemaId,
			updatedJobData,
			sandboxChildJobId,
			sandboxAlreadyQueued,
		},
		deps,
	);

	if ("error" in result) {
		throw new Error(result.error.message);
	}

	return { userId, entity: result.entity };
};

export const processEntityImportJob = async (
	job: Job,
	token?: string,
	deps: EntityImportWorkerDeps = entityImportWorkerDeps,
) => {
	const result = await processEntityPopulationJob(job, token, deps);

	const libraryResult = await deps.ensureEntityInLibrary({
		userId: result.userId,
		entityId: result.entity.id,
	});
	if ("error" in libraryResult) {
		throw new Error(libraryResult.message);
	}

	return result.entity;
};

const createEntityQueueJobId = (prefix: string, input: Record<string, unknown>) => {
	const hash = sha1Hex(JSON.stringify(input));
	return `${prefix}_${hash}`;
};

export const processEntityPreloadJob = async (
	job: Job,
	token?: string,
	deps: EntityImportWorkerDeps = entityImportWorkerDeps,
) => {
	const parsed = entityPreloadJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Entity preload job payload is invalid");
	}

	const { userId, scriptId, entitySchemaId, page, pageSize } = parsed.data;

	let step = parsed.data.step;
	const sandboxChildJobId = `${job.id}_sandbox`;
	if (!step) {
		const script = await deps.getSandboxScriptForUser({ userId, scriptId });
		if (!script) {
			throw new Error("Sandbox script not found");
		}

		await queueSandboxChildRun({
			job,
			childJobId: sandboxChildJobId,
			jobData: { ...parsed.data, step: entityPreloadWaitingForSandboxStep },
			sandboxJobData: {
				userId,
				scriptId,
				driverName: "search",
				context: { query: "", page, pageSize },
			},
		});
		step = entityPreloadWaitingForSandboxStep;
	}

	// oxlint-disable-next-line no-unnecessary-condition
	if (step !== entityPreloadWaitingForSandboxStep) {
		throw new Error(`Unsupported entity preload job step: ${String(step)}`);
	}

	await waitForSandboxChildRun(job, token);

	const sandboxResult = await getSandboxChildRunResult(job, sandboxChildJobId);

	if (!sandboxResult.success) {
		throw new Error(sandboxResult.error ?? "Entity preload search script failed");
	}
	if (sandboxResult.error) {
		throw new Error(sandboxResult.error);
	}

	const searchParsed = entitySearchResultSchema.safeParse(sandboxResult.value);
	if (!searchParsed.success) {
		throw new Error("Entity preload search script returned an unexpected shape");
	}

	const uniqueExternalIds = [...new Set(searchParsed.data.items.map((item) => item.externalId))];
	await Promise.all(
		uniqueExternalIds.map((externalId) => {
			const payload = entityImportJobData.parse({
				userId,
				scriptId,
				externalId,
				entitySchemaId,
			});
			return deps.addEntityQueueJob({
				payload,
				name: entityPreloadImportJobName,
				jobId: createEntityQueueJobId("entity_preload_import", {
					scriptId,
					externalId,
					entitySchemaId,
				}),
			});
		}),
	);

	const nextPage = searchParsed.data.details.nextPage ?? null;
	if (nextPage !== null) {
		const payload = entityPreloadJobData.parse({
			userId,
			pageSize,
			scriptId,
			page: nextPage,
			entitySchemaId,
		});
		await deps.addEntityQueueJob({
			payload,
			name: entityPreloadJobName,
			jobId: createEntityQueueJobId("entity_preload", {
				pageSize,
				scriptId,
				nextPage,
				entitySchemaId,
			}),
		});
	}

	return { nextPage, enqueuedImports: uniqueExternalIds.length };
};

const processEntityQueueJob = async (job: Job, token?: string) => {
	if (job.name === entityImportJobName) {
		return processEntityImportJob(job, token);
	}
	if (job.name === entityPreloadImportJobName) {
		const result = await processEntityPopulationJob(job, token);
		return result.entity;
	}
	if (job.name === entityPreloadJobName) {
		return processEntityPreloadJob(job, token);
	}

	throw new Error(`Unsupported entity import queue job: ${job.name}`);
};

export const createEntityImportWorker = () => {
	const worker = new Worker("entity", processEntityQueueJob, {
		connection: getRedisConnection(),
	});
	worker.on("error", onWorkerError("entity"));
	return worker;
};
