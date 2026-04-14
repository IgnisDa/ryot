import { z } from "@hono/zod-openapi";
import { type AppSchema, normalizeSlug } from "@ryot/ts-utils";
import { type Job, Worker } from "bullmq";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "~/lib/db";
import { entity, entitySchema } from "~/lib/db/schema";
import { personStubSchema } from "~/lib/media/common";
import { personPropertiesSchema } from "~/lib/media/person";
import { getQueues } from "~/lib/queue";
import { getRedisConnection } from "~/lib/queue/connection";
import { onWorkerError } from "~/lib/queue/utils";
import { getSandboxService } from "~/lib/sandbox";
import {
	getEntitySchemaScopeForUser,
	getUserLibraryEntityId,
	upsertInLibraryRelationship,
} from "~/modules/entities";
import {
	createGlobalEntity,
	updateGlobalEntityById,
	upsertPersonRelationship,
} from "~/modules/entities/repository";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas/repository";
import { getBuiltinRelationshipSchemaBySlug } from "~/modules/relationship-schemas";
import {
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

	const [mediaEntityRow] = await db
		.select({ entitySchemaSlug: entitySchema.slug })
		.from(entity)
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.where(and(eq(entity.id, input.mediaEntityId), isNull(entity.userId)))
		.limit(1);

	if (!mediaEntityRow) {
		// Entity was removed after the job was queued; skip silently.
		return;
	}

	const personToMediaSlug = normalizeSlug(
		`person to ${mediaEntityRow.entitySchemaSlug}`,
	);
	const mediaRelSchema =
		await getBuiltinRelationshipSchemaBySlug(personToMediaSlug);

	if (!mediaRelSchema) {
		throw new Error(
			`No person relationship schema seeded for media type "${mediaEntityRow.entitySchemaSlug}" (slug: "${personToMediaSlug}") — check bootstrap manifests`,
		);
	}

	for (const rawStub of rawPeople) {
		const stubResult = personStubSchema.safeParse(rawStub);
		if (!stubResult.success) {
			continue;
		}

		const stub = stubResult.data;

		const personScript = await getBuiltinSandboxScriptBySlug(stub.scriptSlug);
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

		const roleSlug = normalizeSlug(stub.role);

		const extraProperties: Record<string, unknown> = {};
		if (stub.character !== undefined) {
			extraProperties.character = stub.character;
		}
		if (stub.order !== undefined) {
			extraProperties.order = stub.order;
		}

		await upsertPersonRelationship({
			role: roleSlug,
			extraProperties,
			targetEntityId: input.mediaEntityId,
			sourceEntityId: existingOrCreated.id,
			relationshipSchemaId: mediaRelSchema.id,
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
		driverName: "details",
		context: { identifier },
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

	const mediaEntity = await createGlobalEntity({
		entitySchemaId,
		name: details.name,
		sandboxScriptId: scriptId,
		externalId: details.externalId,
	});

	const isNew =
		mediaEntity.properties &&
		typeof mediaEntity.properties === "object" &&
		!("populatedAt" in mediaEntity.properties);

	if (isNew) {
		await updateGlobalEntityById({
			image,
			entitySchemaId,
			name: details.name,
			entityId: mediaEntity.id,
			properties: { ...properties, populatedAt: new Date().toISOString() },
		});
	}

	const libraryEntityId = await getUserLibraryEntityId({ userId });
	if (!libraryEntityId) {
		throw new Error("User library entity not found");
	}

	await upsertInLibraryRelationship({
		userId,
		libraryEntityId,
		mediaEntityId: mediaEntity.id,
	});

	await processPersonStubs({
		userId,
		mediaEntityId: mediaEntity.id,
		rawProperties: details.properties,
	});

	return mediaEntity;
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
		driverName: "details",
		context: { identifier },
		scriptId: personScript.id,
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
