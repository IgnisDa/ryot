import { z } from "@hono/zod-openapi";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { normalizeSlug } from "@ryot/ts-utils/slug";
import { type Job, WaitingChildrenError, Worker } from "bullmq";

import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import { relatedEntityReferenceSchema } from "~/lib/media/common";
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
	writeEntityRelationship,
} from "~/modules/entities";
import {
	getBuiltinEntitySchemaBySandboxScriptId,
	getBuiltinEntitySchemaBySlug,
} from "~/modules/entity-schemas";
import { getBuiltinRelationshipSchemaBySlug } from "~/modules/relationship-schemas";
import { getBuiltinSandboxScriptBySlug, getSandboxScriptForUser } from "~/modules/sandbox";

import { mediaImportJobData, mediaImportJobName, mediaJobWaitingForSandboxStep } from "./jobs";

const mediaDetailsResultSchema = z.object({
	name: z.string(),
	properties: z.record(z.string(), z.unknown()),
	relatedEntities: z.array(relatedEntityReferenceSchema).default([]),
});

const extractPrimaryImage = (images: unknown) => {
	const parsedImages = imagesSchema.safeParse(images);
	return parsedImages.success ? (parsedImages.data[0] ?? null) : null;
};

export const hasImportedEntityDetails = (entityRow: Pick<ListedEntity, "populatedAt">) => {
	return entityRow.populatedAt !== null;
};

export type MediaWorkerDeps = {
	createGlobalEntity: typeof createGlobalEntity;
	updateGlobalEntityById: typeof updateGlobalEntityById;
	getUserLibraryEntityId: typeof getUserLibraryEntityId;
	getSandboxScriptForUser: typeof getSandboxScriptForUser;
	writeEntityRelationship: typeof writeEntityRelationship;
	getEntitySchemaScopeForUser: typeof getEntitySchemaScopeForUser;
	upsertInLibraryRelationship: typeof upsertInLibraryRelationship;
	findGlobalEntityByExternalId: typeof findGlobalEntityByExternalId;
	getBuiltinEntitySchemaBySlug: typeof getBuiltinEntitySchemaBySlug;
	getBuiltinSandboxScriptBySlug: typeof getBuiltinSandboxScriptBySlug;
	getBuiltinRelationshipSchemaBySlug: typeof getBuiltinRelationshipSchemaBySlug;
	getBuiltinEntitySchemaBySandboxScriptId: typeof getBuiltinEntitySchemaBySandboxScriptId;
};

const mediaWorkerDeps: MediaWorkerDeps = {
	createGlobalEntity,
	updateGlobalEntityById,
	getUserLibraryEntityId,
	getSandboxScriptForUser,
	writeEntityRelationship,
	getEntitySchemaScopeForUser,
	upsertInLibraryRelationship,
	findGlobalEntityByExternalId,
	getBuiltinEntitySchemaBySlug,
	getBuiltinSandboxScriptBySlug,
	getBuiltinRelationshipSchemaBySlug,
	getBuiltinEntitySchemaBySandboxScriptId,
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

export const processRelatedEntities = async (
	input: {
		mediaEntityId: string;
		mediaEntitySchemaSlug: string;
		relatedEntities: Array<z.infer<typeof relatedEntityReferenceSchema>>;
	},
	deps: Pick<
		MediaWorkerDeps,
		| "createGlobalEntity"
		| "getBuiltinEntitySchemaBySandboxScriptId"
		| "getBuiltinRelationshipSchemaBySlug"
		| "getBuiltinSandboxScriptBySlug"
		| "writeEntityRelationship"
	> = mediaWorkerDeps,
) => {
	if (input.relatedEntities.length === 0) {
		return;
	}

	// oxlint-disable no-await-in-loop
	for (const relatedEntity of input.relatedEntities) {
		const relatedScript = await deps.getBuiltinSandboxScriptBySlug(relatedEntity.scriptSlug);
		if (!relatedScript) {
			throw new Error(`Related sandbox script not found for slug "${relatedEntity.scriptSlug}"`);
		}

		const relatedSchema = await deps.getBuiltinEntitySchemaBySandboxScriptId(relatedScript.id);
		if (!relatedSchema) {
			throw new Error(
				`Related entity schema not found for sandbox script slug "${relatedEntity.scriptSlug}"`,
			);
		}

		const relationshipSchemaSlug = normalizeSlug(
			`${relatedSchema.slug} to ${input.mediaEntitySchemaSlug}`,
		);

		// oxlint-disable-next-line no-await-in-loop
		const relationshipSchema =
			await deps.getBuiltinRelationshipSchemaBySlug(relationshipSchemaSlug);
		if (!relationshipSchema) {
			throw new Error(
				`No relationship schema seeded for related type "${relatedSchema.slug}" and media type "${input.mediaEntitySchemaSlug}" (slug: "${relationshipSchemaSlug}") — check bootstrap manifests`,
			);
		}

		// oxlint-disable-next-line no-await-in-loop
		const { entity: existingOrCreated } = await deps.createGlobalEntity({
			name: relatedEntity.name,
			entitySchemaId: relatedSchema.id,
			sandboxScriptId: relatedScript.id,
			externalId: relatedEntity.externalId,
		});

		// oxlint-disable-next-line no-await-in-loop
		const relationshipResult = await deps.writeEntityRelationship({
			properties: relatedEntity.relationshipProperties,
			targetEntityId: input.mediaEntityId,
			sourceEntityId: existingOrCreated.id,
			relationshipSchemaId: relationshipSchema.id,
		});
		if ("error" in relationshipResult) {
			throw new Error(
				`Failed to write ${relatedSchema.slug}-to-${input.mediaEntitySchemaSlug} relationship: ${relationshipResult.message}`,
			);
		}
	}
	// oxlint-enable no-await-in-loop
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

	await processRelatedEntities(
		{
			mediaEntityId: mediaEntity.id,
			mediaEntitySchemaSlug: scope.slug,
			relatedEntities: details.relatedEntities,
		},
		deps,
	);

	const updatedEntity = await deps.updateGlobalEntityById({
		image,
		entitySchemaId,
		name: details.name,
		entityId: mediaEntity.id,
		properties: validatedProperties,
		populatedAt: isNew || !mediaEntity.populatedAt ? dayjs().toDate() : mediaEntity.populatedAt,
	});

	await upsertMediaEntityInLibrary({ userId, mediaEntityId: mediaEntity.id }, deps);

	return updatedEntity;
};

const processMediaJob = async (job: Job, token?: string) => {
	if (job.name === mediaImportJobName) {
		return processMediaImportJob(job, token);
	}

	throw new Error(`Unsupported media job: ${job.name}`);
};

export const createMediaWorker = () => {
	// TODO: move this worker into a generic entity import module once the refactor is complete.
	const worker = new Worker("media", processMediaJob, {
		connection: getRedisConnection(),
	});
	worker.on("error", onWorkerError("media"));
	return worker;
};
