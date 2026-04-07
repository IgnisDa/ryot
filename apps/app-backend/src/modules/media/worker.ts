import { z } from "@hono/zod-openapi";
import type { AppSchema } from "@ryot/ts-utils";
import { type Job, Worker } from "bullmq";
import { personStubSchema } from "~/lib/media/book";
import { personPropertiesSchema } from "~/lib/media/person";
import { getQueues } from "~/lib/queue";
import { getRedisConnection } from "~/lib/queue/connection";
import { onWorkerError } from "~/lib/queue/utils";
import { getSandboxService } from "~/lib/sandbox";
import { createEntity, getEntitySchemaScopeForUser } from "~/modules/entities";
import {
	createGlobalEntity,
	updateGlobalEntityById,
	upsertPersonRelationship,
} from "~/modules/entities/repository";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas/repository";
import {
	createApiFunctionDescriptors,
	getBuiltinSandboxScriptBySlug,
	getSandboxScriptForUser,
} from "~/modules/sandbox";
import {
	mediaImportJobData,
	mediaImportJobName,
	personPopulateJobData,
	personPopulateJobName,
} from "./jobs";

const mediaDetailsResultSchema = z.object({
	name: z.string(),
	externalId: z.string(),
	properties: z.record(z.string(), z.unknown()),
});

const personDetailsResultSchema = z.object({
	name: z.string(),
	properties: z.record(z.string(), z.unknown()),
});

const processPersonStubs = async (input: {
	userId: string;
	mediaEntityId: string;
	rawProperties: Record<string, unknown>;
}) => {
	const rawPeople = input.rawProperties.people;
	if (!Array.isArray(rawPeople) || rawPeople.length === 0) {
		return;
	}

	const personSchema = await getBuiltinEntitySchemaBySlug("person");
	if (!personSchema) {
		return;
	}

	const scriptCache = new Map<
		string,
		Awaited<ReturnType<typeof getBuiltinSandboxScriptBySlug>>
	>();

	for (const rawStub of rawPeople) {
		const stubResult = personStubSchema.safeParse(rawStub);
		if (!stubResult.success) {
			continue;
		}

		const stub = stubResult.data;

		let personScript: Awaited<ReturnType<typeof getBuiltinSandboxScriptBySlug>>;
		if (scriptCache.has(stub.scriptSlug)) {
			personScript = scriptCache.get(stub.scriptSlug);
		} else {
			personScript = await getBuiltinSandboxScriptBySlug(stub.scriptSlug);
			scriptCache.set(stub.scriptSlug, personScript);
		}
		if (!personScript) {
			continue;
		}

		const existingOrCreated = await createGlobalEntity({
			name: stub.name,
			externalId: stub.identifier,
			entitySchemaId: personSchema.id,
			sandboxScriptId: personScript.id,
		});

		const isNew =
			existingOrCreated.properties &&
			typeof existingOrCreated.properties === "object" &&
			!("populatedAt" in existingOrCreated.properties);

		const relType = stub.role.toLowerCase().replace(/\s+/g, "_");
		const relProperties: Record<string, unknown> = {};
		if (stub.character !== undefined) {
			relProperties.character = stub.character;
		}
		if (stub.order !== undefined) {
			relProperties.order = stub.order;
		}

		await upsertPersonRelationship({
			relType,
			userId: input.userId,
			properties: relProperties,
			targetEntityId: input.mediaEntityId,
			sourceEntityId: existingOrCreated.id,
		});

		if (isNew) {
			await getQueues().mediaQueue.add(personPopulateJobName, {
				userId: input.userId,
				scriptSlug: stub.scriptSlug,
				identifier: stub.identifier,
				personEntityId: existingOrCreated.id,
			});
		}
	}
};

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

	await processPersonStubs({
		userId,
		rawProperties: details.properties,
		mediaEntityId: entityResult.data.id,
	});

	return entityResult.data;
};

const processPersonPopulateJob = async (job: Job) => {
	const parsed = personPopulateJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Person populate job payload is invalid");
	}

	const { userId, scriptSlug, identifier, personEntityId } = parsed.data;

	const personScript = await getBuiltinSandboxScriptBySlug(scriptSlug);
	if (!personScript) {
		throw new Error("Person script not found");
	}

	const personSchema = await getBuiltinEntitySchemaBySlug("person");
	if (!personSchema) {
		throw new Error("Person entity schema not found");
	}

	const sandboxResult = await getSandboxService().executeQueuedRun({
		userId,
		context: { identifier },
		code: personScript.code,
		scriptId: personScript.id,
		driverName: "personDetails",
		apiFunctionDescriptors: createApiFunctionDescriptors(userId),
	});

	if (!sandboxResult.success) {
		throw new Error(sandboxResult.error ?? "Person details script failed");
	}
	if (sandboxResult.error) {
		throw new Error(sandboxResult.error);
	}

	const detailsParsed = personDetailsResultSchema.safeParse(
		sandboxResult.value,
	);
	if (!detailsParsed.success) {
		throw new Error("Person details script returned an unexpected shape");
	}

	const details = detailsParsed.data;
	const schemaFieldKeys = Object.keys(
		(personSchema.propertiesSchema as AppSchema).fields,
	);
	const filteredProperties: Record<string, unknown> = {};
	for (const key of schemaFieldKeys) {
		if (details.properties[key] !== undefined) {
			filteredProperties[key] = details.properties[key];
		}
	}

	const validatedProperties = personPropertiesSchema
		.partial()
		.safeParse(filteredProperties);
	if (!validatedProperties.success) {
		throw new Error("Person details properties are invalid");
	}

	const assets = details.properties.assets as
		| { remoteImages?: string[] }
		| undefined;
	const firstImage = assets?.remoteImages?.[0];
	const image = firstImage
		? { kind: "remote" as const, url: firstImage }
		: null;

	await updateGlobalEntityById({
		image,
		name: details.name,
		entityId: personEntityId,
		entitySchemaId: personSchema.id,
		properties: {
			...validatedProperties.data,
			populatedAt: new Date().toISOString(),
		},
	});
};

const processMediaJob = async (job: Job) => {
	if (job.name === mediaImportJobName) {
		return processMediaImportJob(job);
	}

	if (job.name === personPopulateJobName) {
		return processPersonPopulateJob(job);
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
