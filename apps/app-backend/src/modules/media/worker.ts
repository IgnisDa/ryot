import { z } from "@hono/zod-openapi";
import type { AppSchema } from "@ryot/ts-utils";
import { type Job, Worker } from "bullmq";
import { getRedisConnection } from "~/lib/queue/connection";
import { onWorkerError } from "~/lib/queue/utils";
import { getSandboxService } from "~/lib/sandbox";
import { createEntity, getEntitySchemaScopeForUser } from "~/modules/entities";
import {
	createApiFunctionDescriptors,
	getSandboxScriptForUser,
} from "~/modules/sandbox";
import { mediaImportJobData, mediaImportJobName } from "./jobs";

const mediaDetailsResultSchema = z.object({
	name: z.string(),
	externalId: z.string(),
	properties: z.record(z.string(), z.unknown()),
});

const processMediaImportJob = async (job: Job) => {
	const parsed = mediaImportJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Media import job payload is invalid");
	}

	const { userId, scriptId, identifier, entitySchemaId } = parsed.data;

	const script = await getSandboxScriptForUser({ userId, scriptId });
	if (!script) {
		throw new Error("Sandbox script not found");
	}

	const scope = await getEntitySchemaScopeForUser({ userId, entitySchemaId });
	if (!scope) {
		throw new Error("Entity schema not found");
	}

	const sandboxResult = await getSandboxService().executeQueuedRun({
		userId,
		scriptId,
		code: script.code,
		context: { identifier },
		driverName: "mediaDetails",
		apiFunctionDescriptors: createApiFunctionDescriptors(userId),
	});

	if (!sandboxResult.success) {
		throw new Error(sandboxResult.error ?? "Media details script failed");
	}
	if (sandboxResult.error) {
		throw new Error(sandboxResult.error);
	}

	const detailsParsed = mediaDetailsResultSchema.safeParse(sandboxResult.value);
	if (!detailsParsed.success) {
		throw new Error("Media details script returned an unexpected shape");
	}

	const details = detailsParsed.data;
	const schemaFieldKeys = Object.keys(
		(scope.propertiesSchema as AppSchema).fields,
	);
	const properties: Record<string, unknown> = {};
	for (const key of schemaFieldKeys) {
		if (details.properties[key] !== undefined) {
			properties[key] = details.properties[key];
		}
	}

	const assets = details.properties.assets as
		| { remoteImages?: string[] }
		| undefined;
	const firstImage = assets?.remoteImages?.[0];
	const image = firstImage
		? { kind: "remote" as const, url: firstImage }
		: null;

	const entityResult = await createEntity({
		userId,
		body: {
			image,
			properties,
			entitySchemaId,
			name: details.name,
			sandboxScriptId: scriptId,
			externalId: details.externalId,
		},
	});

	if ("error" in entityResult) {
		throw new Error(entityResult.message);
	}

	return entityResult.data;
};

const processMediaJob = async (job: Job) => {
	if (job.name === mediaImportJobName) {
		return processMediaImportJob(job);
	}

	throw new Error(`Unsupported media job: ${job.name}`);
};

export const createMediaWorker = () => {
	const worker = new Worker("media", processMediaJob, {
		connection: getRedisConnection(),
	});
	worker.on("error", onWorkerError("media"));
	return worker;
};
