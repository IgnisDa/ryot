import { z } from "@hono/zod-openapi";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { normalizeSlug } from "@ryot/ts-utils/slug";
import { type Job, WaitingChildrenError, Worker } from "bullmq";
import { and, eq, isNull } from "drizzle-orm";

import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import { db } from "~/lib/db";
import { entity, entitySchema } from "~/lib/db/schema";
import { companyStubSchema, groupStubSchema, personStubSchema } from "~/lib/media/common";
import { companyPropertiesSchema } from "~/lib/media/company";
import { mediaGroupPropertiesSchema } from "~/lib/media/media-group";
import { personPropertiesSchema } from "~/lib/media/person";
import { getQueues } from "~/lib/queue";
import { getRedisConnection } from "~/lib/queue/connection";
import { onWorkerError } from "~/lib/queue/utils";
import { sandboxRunJobName, sandboxRunJobResult } from "~/lib/sandbox/jobs";
import { imagesSchema } from "~/lib/zod";
import {
	createGlobalEntity,
	findGlobalEntityByExternalId,
	getEntitySchemaScopeForUser,
	getUserLibraryEntityId,
	type ListedEntity,
	updateGlobalEntityById,
	upsertInLibraryRelationship,
	upsertEntityRelationship,
} from "~/modules/entities";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas";
import { getBuiltinRelationshipSchemaBySlug } from "~/modules/relationship-schemas";
import { getBuiltinSandboxScriptBySlug, getSandboxScriptForUser } from "~/modules/sandbox";

import {
	companyPopulateJobData,
	companyPopulateJobName,
	groupPopulateJobData,
	groupPopulateJobName,
	mediaImportJobData,
	mediaImportJobName,
	mediaJobWaitingForSandboxStep,
	personPopulateJobData,
	personPopulateJobName,
} from "./jobs";

const mediaDetailsResultSchema = z.object({
	name: z.string(),
	properties: z.record(z.string(), z.unknown()),
});

const personDetailsResultSchema = z.object({
	name: z.string(),
	properties: z.record(z.string(), z.unknown()),
});

const companyDetailsResultSchema = z.object({
	name: z.string(),
	properties: z.record(z.string(), z.unknown()),
});

const groupDetailsResultSchema = z.object({
	name: z.string(),
	properties: z.record(z.string(), z.unknown()),
});

const extractPrimaryImage = (images: unknown) => {
	const parsedImages = imagesSchema.safeParse(images);
	return parsedImages.success ? (parsedImages.data[0] ?? null) : null;
};

export const hasImportedEntityDetails = (
	entityRow: Pick<ListedEntity, "image" | "properties" | "populatedAt">,
) => {
	if (entityRow.populatedAt.getTime() <= 0) {
		return false;
	}

	return entityRow.image !== null || Object.keys(entityRow.properties).length > 0;
};

export type MediaWorkerDeps = {
	createGlobalEntity: typeof createGlobalEntity;
	updateGlobalEntityById: typeof updateGlobalEntityById;
	getUserLibraryEntityId: typeof getUserLibraryEntityId;
	getSandboxScriptForUser: typeof getSandboxScriptForUser;
	getEntitySchemaScopeForUser: typeof getEntitySchemaScopeForUser;
	upsertInLibraryRelationship: typeof upsertInLibraryRelationship;
	findGlobalEntityByExternalId: typeof findGlobalEntityByExternalId;
	getBuiltinEntitySchemaBySlug: typeof getBuiltinEntitySchemaBySlug;
	getBuiltinSandboxScriptBySlug: typeof getBuiltinSandboxScriptBySlug;
};

const mediaWorkerDeps: MediaWorkerDeps = {
	createGlobalEntity,
	updateGlobalEntityById,
	getUserLibraryEntityId,
	getSandboxScriptForUser,
	getEntitySchemaScopeForUser,
	upsertInLibraryRelationship,
	findGlobalEntityByExternalId,
	getBuiltinEntitySchemaBySlug,
	getBuiltinSandboxScriptBySlug,
};

const findImportedGlobalEntity = async (
	input: {
		externalId: string;
		entitySchemaId: string;
		sandboxScriptId: string;
	},
	deps: Pick<MediaWorkerDeps, "findGlobalEntityByExternalId"> = mediaWorkerDeps,
) => {
	const existingEntity = await deps.findGlobalEntityByExternalId(input);
	if (!existingEntity || !hasImportedEntityDetails(existingEntity)) {
		return null;
	}

	return existingEntity;
};

const upsertMediaEntityInLibrary = async (
	input: { userId: string; mediaEntityId: string },
	deps: Pick<
		MediaWorkerDeps,
		"getUserLibraryEntityId" | "upsertInLibraryRelationship"
	> = mediaWorkerDeps,
) => {
	const libraryEntityId = await deps.getUserLibraryEntityId({
		userId: input.userId,
	});
	if (!libraryEntityId) {
		throw new Error("User library entity not found");
	}

	await deps.upsertInLibraryRelationship({
		libraryEntityId,
		userId: input.userId,
		mediaEntityId: input.mediaEntityId,
	});
};

const queueSandboxChildRun = async (input: {
	job: Job;
	childJobId: string;
	jobData: Record<string, unknown>;
	sandboxJobData: Record<string, unknown>;
}) => {
	if (!input.job.id) {
		throw new Error("Media job id is missing");
	}

	await getQueues().sandboxQueue.add(sandboxRunJobName, input.sandboxJobData, {
		jobId: input.childJobId,
		parent: {
			id: input.job.id,
			queue: input.job.queueQualifiedName,
		},
	});
	await input.job.updateData(input.jobData);
};

const waitForSandboxChildRun = async (job: Job, token: string | undefined) => {
	if (!token) {
		throw new Error("Media job token is missing");
	}

	const shouldWait = await job.moveToWaitingChildren(token);
	if (shouldWait) {
		throw new WaitingChildrenError();
	}
};

const getSandboxChildRunResult = async (job: Job) => {
	const childrenValues = await job.getChildrenValues();
	const [childValue] = Object.values(childrenValues);
	if (Object.keys(childrenValues).length !== 1) {
		throw new Error("Sandbox child job did not complete successfully");
	}

	const parsed = sandboxRunJobResult.safeParse(childValue);
	if (!parsed.success) {
		throw new Error("Sandbox child job returned an invalid payload");
	}

	return parsed.data;
};

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

	const personToMediaSlug = normalizeSlug(`person to ${mediaEntityRow.entitySchemaSlug}`);
	const mediaRelSchema = await getBuiltinRelationshipSchemaBySlug(personToMediaSlug);

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

		// oxlint-disable-next-line no-await-in-loop
		const personScript = await getBuiltinSandboxScriptBySlug(stub.scriptSlug);
		if (!personScript) {
			continue;
		}

		// oxlint-disable-next-line no-await-in-loop
		const { entity: existingOrCreated, isNew } = await createGlobalEntity({
			name: stub.name,
			externalId: stub.externalId,
			entitySchemaId: personSchema.id,
			sandboxScriptId: personScript.id,
		});

		const roleSlug = normalizeSlug(stub.role);

		const extraProperties: Record<string, unknown> = {};
		if (stub.character !== undefined) {
			extraProperties.character = stub.character;
		}
		if (stub.order !== undefined) {
			extraProperties.order = stub.order;
		}

		// oxlint-disable-next-line no-await-in-loop
		await upsertEntityRelationship({
			role: roleSlug,
			extraProperties,
			targetEntityId: input.mediaEntityId,
			sourceEntityId: existingOrCreated.id,
			relationshipSchemaId: mediaRelSchema.id,
		});

		if (isNew || !hasImportedEntityDetails(existingOrCreated)) {
			// oxlint-disable-next-line no-await-in-loop
			await getQueues().mediaQueue.add(
				personPopulateJobName,
				{
					userId: input.userId,
					scriptSlug: stub.scriptSlug,
					externalId: stub.externalId,
					personEntityId: existingOrCreated.id,
				},
				{ jobId: `person-populate-${existingOrCreated.id}` },
			);
		}
	}
};

const processCompanyStubs = async (input: {
	userId: string;
	mediaEntityId: string;
	rawProperties: Record<string, unknown>;
}) => {
	const rawCompanies = input.rawProperties.companies;
	if (!Array.isArray(rawCompanies) || rawCompanies.length === 0) {
		return;
	}

	const companySchema = await getBuiltinEntitySchemaBySlug("company");
	if (!companySchema) {
		return;
	}

	const [mediaEntityRow] = await db
		.select({ entitySchemaSlug: entitySchema.slug })
		.from(entity)
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.where(and(eq(entity.id, input.mediaEntityId), isNull(entity.userId)))
		.limit(1);

	if (!mediaEntityRow) {
		return;
	}

	const companyToMediaSlug = normalizeSlug(`company to ${mediaEntityRow.entitySchemaSlug}`);
	const mediaRelSchema = await getBuiltinRelationshipSchemaBySlug(companyToMediaSlug);

	if (!mediaRelSchema) {
		throw new Error(
			`No company relationship schema seeded for media type "${mediaEntityRow.entitySchemaSlug}" (slug: "${companyToMediaSlug}") — check bootstrap manifests`,
		);
	}

	for (const rawStub of rawCompanies) {
		const stubResult = companyStubSchema.safeParse(rawStub);
		if (!stubResult.success) {
			continue;
		}

		const stub = stubResult.data;

		// oxlint-disable-next-line no-await-in-loop
		const companyScript = await getBuiltinSandboxScriptBySlug(stub.scriptSlug);
		if (!companyScript) {
			continue;
		}

		// oxlint-disable-next-line no-await-in-loop
		const { entity: existingOrCreated, isNew } = await createGlobalEntity({
			name: stub.name,
			externalId: stub.externalId,
			entitySchemaId: companySchema.id,
			sandboxScriptId: companyScript.id,
		});

		const roleSlug = normalizeSlug(stub.role);

		const extraProperties: Record<string, unknown> = {};
		if (stub.order !== undefined) {
			extraProperties.order = stub.order;
		}

		// oxlint-disable-next-line no-await-in-loop
		await upsertEntityRelationship({
			role: roleSlug,
			extraProperties,
			targetEntityId: input.mediaEntityId,
			sourceEntityId: existingOrCreated.id,
			relationshipSchemaId: mediaRelSchema.id,
		});

		if (isNew || !hasImportedEntityDetails(existingOrCreated)) {
			// oxlint-disable-next-line no-await-in-loop
			await getQueues().mediaQueue.add(
				companyPopulateJobName,
				{
					userId: input.userId,
					scriptSlug: stub.scriptSlug,
					externalId: stub.externalId,
					companyEntityId: existingOrCreated.id,
				},
				{ jobId: `company-populate-${existingOrCreated.id}` },
			);
		}
	}
};

const processGroupStubs = async (input: {
	userId: string;
	mediaEntityId: string;
	rawProperties: Record<string, unknown>;
}) => {
	const rawGroups = input.rawProperties.groups;
	if (!Array.isArray(rawGroups) || rawGroups.length === 0) {
		return;
	}

	const [mediaEntityRow] = await db
		.select({ entitySchemaSlug: entitySchema.slug })
		.from(entity)
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.where(and(eq(entity.id, input.mediaEntityId), isNull(entity.userId)))
		.limit(1);

	if (!mediaEntityRow) {
		return;
	}

	const groupSchemaSlug = normalizeSlug(`${mediaEntityRow.entitySchemaSlug}-group`);
	const groupSchema = await getBuiltinEntitySchemaBySlug(groupSchemaSlug);
	if (!groupSchema) {
		return;
	}

	const groupToMediaSlug = normalizeSlug(
		`${groupSchemaSlug} to ${mediaEntityRow.entitySchemaSlug}`,
	);
	const mediaRelSchema = await getBuiltinRelationshipSchemaBySlug(groupToMediaSlug);

	if (!mediaRelSchema) {
		throw new Error(
			`No group relationship schema seeded for media type "${mediaEntityRow.entitySchemaSlug}" (slug: "${groupToMediaSlug}") — check bootstrap manifests`,
		);
	}

	for (const rawStub of rawGroups) {
		const stubResult = groupStubSchema.safeParse(rawStub);
		if (!stubResult.success) {
			continue;
		}

		const stub = stubResult.data;

		// oxlint-disable-next-line no-await-in-loop
		const groupScript = await getBuiltinSandboxScriptBySlug(stub.scriptSlug);
		if (!groupScript) {
			continue;
		}

		// oxlint-disable-next-line no-await-in-loop
		const { entity: existingOrCreated, isNew } = await createGlobalEntity({
			name: stub.name,
			externalId: stub.externalId,
			entitySchemaId: groupSchema.id,
			sandboxScriptId: groupScript.id,
		});

		// oxlint-disable-next-line no-await-in-loop
		await upsertEntityRelationship({
			role: "member",
			extraProperties: {},
			targetEntityId: input.mediaEntityId,
			sourceEntityId: existingOrCreated.id,
			relationshipSchemaId: mediaRelSchema.id,
		});

		if (isNew || !hasImportedEntityDetails(existingOrCreated)) {
			// oxlint-disable-next-line no-await-in-loop
			await getQueues().mediaQueue.add(
				groupPopulateJobName,
				{
					groupSchemaSlug,
					userId: input.userId,
					scriptSlug: stub.scriptSlug,
					externalId: stub.externalId,
					groupEntityId: existingOrCreated.id,
				},
				{ jobId: `group-populate-${existingOrCreated.id}` },
			);
		}
	}
};

export const processMediaImportJob = async (
	job: Job,
	token?: string,
	deps: MediaWorkerDeps = mediaWorkerDeps,
) => {
	const parsed = mediaImportJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Media import job payload is invalid");
	}

	const { userId, scriptId, externalId, entitySchemaId } = parsed.data;

	let step = parsed.data.step;
	if (!step) {
		const script = await deps.getSandboxScriptForUser({ userId, scriptId });
		if (!script) {
			throw new Error("Sandbox script not found");
		}
	}

	const existingEntity = await findImportedGlobalEntity(
		{ externalId, entitySchemaId, sandboxScriptId: scriptId },
		deps,
	);
	if (existingEntity) {
		await upsertMediaEntityInLibrary({ userId, mediaEntityId: existingEntity.id }, deps);
		return existingEntity;
	}

	if (!step) {
		await queueSandboxChildRun({
			job,
			childJobId: `${job.id}_sandbox`,
			jobData: {
				...parsed.data,
				step: mediaJobWaitingForSandboxStep,
			},
			sandboxJobData: {
				userId,
				scriptId,
				driverName: "details",
				context: { externalId },
			},
		});
		step = mediaJobWaitingForSandboxStep;
	}

	// oxlint-disable-next-line no-unnecessary-condition
	if (step !== mediaJobWaitingForSandboxStep) {
		throw new Error(`Unsupported media import job step: ${String(step)}`);
	}

	await waitForSandboxChildRun(job, token);

	const sandboxResult = await getSandboxChildRunResult(job);

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
	const scope = await deps.getEntitySchemaScopeForUser({
		userId,
		entitySchemaId,
	});
	if (!scope) {
		throw new Error("Entity schema not found");
	}
	const schemaFieldKeys = Object.keys(scope.propertiesSchema.fields);
	const properties: Record<string, unknown> = {};
	for (const key of schemaFieldKeys) {
		if (details.properties[key] !== undefined) {
			properties[key] = details.properties[key];
		}
	}
	const validatedProperties = parseAppSchemaProperties({
		properties,
		kind: "Media",
		propertiesSchema: scope.propertiesSchema,
	});
	const parsedImages = imagesSchema.safeParse(validatedProperties.images);
	if (!parsedImages.success) {
		throw new Error("Media details images are invalid");
	}
	validatedProperties.images = parsedImages.data;

	const image = extractPrimaryImage(validatedProperties.images);

	const { entity: mediaEntity, isNew } = await deps.createGlobalEntity({
		externalId,
		entitySchemaId,
		name: details.name,
		sandboxScriptId: scriptId,
	});

	const updatedEntity = await deps.updateGlobalEntityById({
		image,
		entitySchemaId,
		name: details.name,
		entityId: mediaEntity.id,
		removePropertyKeys: ["assets"],
		properties: validatedProperties,
		populatedAt: isNew ? dayjs().toDate() : mediaEntity.populatedAt,
	});

	await upsertMediaEntityInLibrary({ userId, mediaEntityId: mediaEntity.id }, deps);

	await processPersonStubs({
		userId,
		mediaEntityId: mediaEntity.id,
		rawProperties: details.properties,
	});

	await processCompanyStubs({
		userId,
		mediaEntityId: mediaEntity.id,
		rawProperties: details.properties,
	});

	await processGroupStubs({
		userId,
		mediaEntityId: mediaEntity.id,
		rawProperties: details.properties,
	});

	return updatedEntity;
};

export const processPersonPopulateJob = async (
	job: Job,
	token?: string,
	deps: MediaWorkerDeps = mediaWorkerDeps,
) => {
	const parsed = personPopulateJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Person populate job payload is invalid");
	}

	const { userId, scriptSlug, externalId, personEntityId } = parsed.data;
	const personScript = await deps.getBuiltinSandboxScriptBySlug(scriptSlug);
	if (!personScript) {
		throw new Error("Person script not found");
	}

	const personSchema = await deps.getBuiltinEntitySchemaBySlug("person");
	if (!personSchema) {
		throw new Error("Person entity schema not found");
	}

	const existingEntity = await findImportedGlobalEntity(
		{
			externalId,
			entitySchemaId: personSchema.id,
			sandboxScriptId: personScript.id,
		},
		deps,
	);
	if (existingEntity) {
		return;
	}

	let step = parsed.data.step;
	if (!step) {
		await queueSandboxChildRun({
			job,
			childJobId: `${job.id}_sandbox`,
			jobData: {
				...parsed.data,
				step: mediaJobWaitingForSandboxStep,
			},
			sandboxJobData: {
				userId,
				driverName: "details",
				context: { externalId },
				scriptId: personScript.id,
			},
		});
		step = mediaJobWaitingForSandboxStep;
	}

	// oxlint-disable-next-line no-unnecessary-condition
	if (step !== mediaJobWaitingForSandboxStep) {
		throw new Error(`Unsupported person populate job step: ${String(step)}`);
	}

	await waitForSandboxChildRun(job, token);

	const sandboxResult = await getSandboxChildRunResult(job);

	if (!sandboxResult.success) {
		throw new Error(sandboxResult.error ?? "Person details script failed");
	}
	if (sandboxResult.error) {
		throw new Error(sandboxResult.error);
	}

	const detailsParsed = personDetailsResultSchema.safeParse(sandboxResult.value);
	if (!detailsParsed.success) {
		throw new Error("Person details script returned an unexpected shape");
	}

	const details = detailsParsed.data;
	const schemaFieldKeys = Object.keys(personSchema.propertiesSchema.fields);
	const filteredProperties: Record<string, unknown> = {};
	for (const key of schemaFieldKeys) {
		if (details.properties[key] !== undefined) {
			filteredProperties[key] = details.properties[key];
		}
	}

	const validatedProperties = personPropertiesSchema.partial().safeParse(filteredProperties);
	if (!validatedProperties.success) {
		throw new Error("Person details properties are invalid");
	}

	const image = extractPrimaryImage(validatedProperties.data.images);

	await deps.updateGlobalEntityById({
		image,
		name: details.name,
		populatedAt: dayjs().toDate(),
		entityId: personEntityId,
		removePropertyKeys: ["assets"],
		entitySchemaId: personSchema.id,
		properties: { ...validatedProperties.data },
	});
};

export const processCompanyPopulateJob = async (
	job: Job,
	token?: string,
	deps: MediaWorkerDeps = mediaWorkerDeps,
) => {
	const parsed = companyPopulateJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Company populate job payload is invalid");
	}

	const { userId, scriptSlug, externalId, companyEntityId } = parsed.data;
	const companyScript = await deps.getBuiltinSandboxScriptBySlug(scriptSlug);
	if (!companyScript) {
		throw new Error("Company script not found");
	}

	const companySchema = await deps.getBuiltinEntitySchemaBySlug("company");
	if (!companySchema) {
		throw new Error("Company entity schema not found");
	}

	const existingEntity = await findImportedGlobalEntity(
		{
			externalId,
			entitySchemaId: companySchema.id,
			sandboxScriptId: companyScript.id,
		},
		deps,
	);
	if (existingEntity) {
		return;
	}

	let step = parsed.data.step;
	if (!step) {
		await queueSandboxChildRun({
			job,
			childJobId: `${job.id}_sandbox`,
			jobData: {
				...parsed.data,
				step: mediaJobWaitingForSandboxStep,
			},
			sandboxJobData: {
				userId,
				driverName: "details",
				context: { externalId },
				scriptId: companyScript.id,
			},
		});
		step = mediaJobWaitingForSandboxStep;
	}

	// oxlint-disable-next-line no-unnecessary-condition
	if (step !== mediaJobWaitingForSandboxStep) {
		throw new Error(`Unsupported company populate job step: ${String(step)}`);
	}

	await waitForSandboxChildRun(job, token);

	const sandboxResult = await getSandboxChildRunResult(job);

	if (!sandboxResult.success) {
		throw new Error(sandboxResult.error ?? "Company details script failed");
	}
	if (sandboxResult.error) {
		throw new Error(sandboxResult.error);
	}

	const detailsParsed = companyDetailsResultSchema.safeParse(sandboxResult.value);
	if (!detailsParsed.success) {
		throw new Error("Company details script returned an unexpected shape");
	}

	const details = detailsParsed.data;
	const schemaFieldKeys = Object.keys(companySchema.propertiesSchema.fields);
	const filteredProperties: Record<string, unknown> = {};
	for (const key of schemaFieldKeys) {
		if (details.properties[key] !== undefined) {
			filteredProperties[key] = details.properties[key];
		}
	}

	const validatedProperties = companyPropertiesSchema.partial().safeParse(filteredProperties);
	if (!validatedProperties.success) {
		throw new Error("Company details properties are invalid");
	}

	const image = extractPrimaryImage(validatedProperties.data.images);

	await deps.updateGlobalEntityById({
		image,
		name: details.name,
		populatedAt: dayjs().toDate(),
		entityId: companyEntityId,
		removePropertyKeys: ["assets"],
		entitySchemaId: companySchema.id,
		properties: { ...validatedProperties.data },
	});
};

export const processGroupPopulateJob = async (
	job: Job,
	token?: string,
	deps: MediaWorkerDeps = mediaWorkerDeps,
) => {
	const parsed = groupPopulateJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Group populate job payload is invalid");
	}

	const { userId, scriptSlug, externalId, groupEntityId, groupSchemaSlug } = parsed.data;
	const groupScript = await deps.getBuiltinSandboxScriptBySlug(scriptSlug);
	if (!groupScript) {
		throw new Error("Group script not found");
	}

	const groupSchema = await deps.getBuiltinEntitySchemaBySlug(groupSchemaSlug);
	if (!groupSchema) {
		throw new Error("Group entity schema not found");
	}

	const existingEntity = await findImportedGlobalEntity(
		{
			externalId,
			entitySchemaId: groupSchema.id,
			sandboxScriptId: groupScript.id,
		},
		deps,
	);
	if (existingEntity) {
		return;
	}

	let step = parsed.data.step;
	if (!step) {
		await queueSandboxChildRun({
			job,
			childJobId: `${job.id}_sandbox`,
			jobData: {
				...parsed.data,
				step: mediaJobWaitingForSandboxStep,
			},
			sandboxJobData: {
				userId,
				driverName: "details",
				context: { externalId },
				scriptId: groupScript.id,
			},
		});
		step = mediaJobWaitingForSandboxStep;
	}

	// oxlint-disable-next-line no-unnecessary-condition
	if (step !== mediaJobWaitingForSandboxStep) {
		throw new Error(`Unsupported group populate job step: ${String(step)}`);
	}

	await waitForSandboxChildRun(job, token);

	const sandboxResult = await getSandboxChildRunResult(job);

	if (!sandboxResult.success) {
		throw new Error(sandboxResult.error ?? "Group details script failed");
	}
	if (sandboxResult.error) {
		throw new Error(sandboxResult.error);
	}

	const detailsParsed = groupDetailsResultSchema.safeParse(sandboxResult.value);
	if (!detailsParsed.success) {
		throw new Error("Group details script returned an unexpected shape");
	}

	const details = detailsParsed.data;
	const schemaFieldKeys = Object.keys(groupSchema.propertiesSchema.fields);
	const filteredProperties: Record<string, unknown> = {};
	for (const key of schemaFieldKeys) {
		if (details.properties[key] !== undefined) {
			filteredProperties[key] = details.properties[key];
		}
	}

	const validatedProperties = mediaGroupPropertiesSchema.partial().safeParse(filteredProperties);
	if (!validatedProperties.success) {
		throw new Error("Group details properties are invalid");
	}

	const image = extractPrimaryImage(validatedProperties.data.images);

	await deps.updateGlobalEntityById({
		image,
		name: details.name,
		entityId: groupEntityId,
		populatedAt: dayjs().toDate(),
		removePropertyKeys: ["assets"],
		entitySchemaId: groupSchema.id,
		properties: { ...validatedProperties.data },
	});
};

const processMediaJob = async (job: Job, token?: string) => {
	if (job.name === mediaImportJobName) {
		return processMediaImportJob(job, token);
	}

	if (job.name === personPopulateJobName) {
		return processPersonPopulateJob(job, token);
	}

	if (job.name === companyPopulateJobName) {
		return processCompanyPopulateJob(job, token);
	}

	if (job.name === groupPopulateJobName) {
		return processGroupPopulateJob(job, token);
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
