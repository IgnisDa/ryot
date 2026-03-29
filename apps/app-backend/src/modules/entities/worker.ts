import { createHash } from "node:crypto";

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
	getBuiltinEntitySchemaBySandboxScriptId,
	getBuiltinEntitySchemaBySlug,
} from "~/modules/entity-schemas";
import { getBuiltinRelationshipSchemaBySlug } from "~/modules/relationship-schemas";
import { getBuiltinSandboxScriptBySlug, getSandboxScriptForUser } from "~/modules/sandbox";

import {
	entityImportJobData,
	entityImportJobName,
	entityImportWaitingForSandboxStep,
	entityPreloadJobData,
	entityPreloadJobName,
	entityPreloadWaitingForSandboxStep,
} from "./jobs";
import {
	createGlobalEntity,
	findGlobalEntityByExternalId,
	getEntitySchemaScopeForUser,
	getUserLibraryEntityId,
	updateGlobalEntityById,
	upsertInLibraryRelationship,
} from "./repository";
import type { ListedEntity } from "./schemas";
import { writeEntityRelationship } from "./service";

const entityDetailsResultSchema = z.object({
	name: z.string(),
	properties: z.record(z.string(), z.unknown()),
	relatedEntities: z.array(relatedEntityReferenceSchema).default([]),
});

const entitySearchResultSchema = z.object({
	items: z.array(z.object({ externalId: z.string().min(1) })),
	details: z.object({
		nextPage: z.number().int().positive().nullable().optional(),
	}),
});

const extractPrimaryImage = (images: unknown) => {
	const parsedImages = imagesSchema.safeParse(images);
	return parsedImages.success ? (parsedImages.data[0] ?? null) : null;
};

export const hasImportedEntityDetails = (entityRow: Pick<ListedEntity, "populatedAt">) =>
	entityRow.populatedAt !== null;

export type EntityImportWorkerDeps = {
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
	addEntityQueueJob,
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
	deps: Pick<EntityImportWorkerDeps, "findGlobalEntityByExternalId"> = entityImportWorkerDeps,
) => {
	const existingEntity = await deps.findGlobalEntityByExternalId(input);
	if (!existingEntity || !hasImportedEntityDetails(existingEntity)) {
		return null;
	}

	return existingEntity;
};

const upsertEntityInLibrary = async (
	input: { userId: string; entityId: string },
	deps: Pick<
		EntityImportWorkerDeps,
		"getUserLibraryEntityId" | "upsertInLibraryRelationship"
	> = entityImportWorkerDeps,
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
		mediaEntityId: input.entityId,
	});
};

const queueSandboxChildRun = async (input: {
	job: Job;
	childJobId: string;
	jobData: Record<string, unknown>;
	sandboxJobData: Record<string, unknown>;
}) => {
	if (!input.job.id) {
		throw new Error("Entity import job id is missing");
	}

	await getQueues().sandboxQueue.add(sandboxRunJobName, input.sandboxJobData, {
		jobId: input.childJobId,
		parent: { id: input.job.id, queue: input.job.queueQualifiedName },
	});
	await input.job.updateData(input.jobData);
};

const waitForSandboxChildRun = async (job: Job, token: string | undefined) => {
	if (!token) {
		throw new Error("Entity import job token is missing");
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
		entityId: string;
		entitySchemaSlug: string;
		relatedEntities: Array<z.infer<typeof relatedEntityReferenceSchema>>;
	},
	deps: Pick<
		EntityImportWorkerDeps,
		| "createGlobalEntity"
		| "getBuiltinEntitySchemaBySandboxScriptId"
		| "getBuiltinRelationshipSchemaBySlug"
		| "getBuiltinSandboxScriptBySlug"
		| "writeEntityRelationship"
	> = entityImportWorkerDeps,
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
			`${relatedSchema.slug} to ${input.entitySchemaSlug}`,
		);

		const relationshipSchema =
			await deps.getBuiltinRelationshipSchemaBySlug(relationshipSchemaSlug);
		if (!relationshipSchema) {
			throw new Error(
				`No relationship schema seeded for related type "${relatedSchema.slug}" and entity type "${input.entitySchemaSlug}" (slug: "${relationshipSchemaSlug}") — check bootstrap manifests`,
			);
		}

		const { entity: existingOrCreated } = await deps.createGlobalEntity({
			name: relatedEntity.name,
			entitySchemaId: relatedSchema.id,
			sandboxScriptId: relatedScript.id,
			externalId: relatedEntity.externalId,
		});

		const relationshipResult = await deps.writeEntityRelationship({
			targetEntityId: input.entityId,
			sourceEntityId: existingOrCreated.id,
			relationshipSchemaId: relationshipSchema.id,
			properties: relatedEntity.relationshipProperties,
		});
		if ("error" in relationshipResult) {
			throw new Error(
				`Failed to write ${relatedSchema.slug}-to-${input.entitySchemaSlug} relationship: ${relationshipResult.message}`,
			);
		}
	}
	// oxlint-enable no-await-in-loop
};

export const processEntityImportJob = async (
	job: Job,
	token?: string,
	deps: EntityImportWorkerDeps = entityImportWorkerDeps,
) => {
	const parsed = entityImportJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Entity import job payload is invalid");
	}

	const { userId, scriptId, externalId, entitySchemaId, linkToLibrary } = parsed.data;

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
		if (linkToLibrary) {
			await upsertEntityInLibrary({ userId, entityId: existingEntity.id }, deps);
		}
		return existingEntity;
	}

	if (!step) {
		await queueSandboxChildRun({
			job,
			childJobId: `${job.id}_sandbox`,
			jobData: { ...parsed.data, step: entityImportWaitingForSandboxStep },
			sandboxJobData: { userId, scriptId, driverName: "details", context: { externalId } },
		});
		step = entityImportWaitingForSandboxStep;
	}

	// oxlint-disable-next-line no-unnecessary-condition
	if (step !== entityImportWaitingForSandboxStep) {
		throw new Error(`Unsupported entity import job step: ${String(step)}`);
	}

	await waitForSandboxChildRun(job, token);

	const sandboxResult = await getSandboxChildRunResult(job);

	if (!sandboxResult.success) {
		throw new Error(sandboxResult.error ?? "Entity details script failed");
	}
	if (sandboxResult.error) {
		throw new Error(sandboxResult.error);
	}

	const detailsParsed = entityDetailsResultSchema.safeParse(sandboxResult.value);
	if (!detailsParsed.success) {
		throw new Error("Entity details script returned an unexpected shape");
	}

	const details = detailsParsed.data;
	const scope = await deps.getEntitySchemaScopeForUser({ userId, entitySchemaId });
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
		kind: "Entity",
		propertiesSchema: scope.propertiesSchema,
	});
	const parsedImages = imagesSchema.safeParse(validatedProperties.images);
	if (!parsedImages.success) {
		throw new Error("Entity details images are invalid");
	}
	validatedProperties.images = parsedImages.data;

	const image = extractPrimaryImage(validatedProperties.images);

	const { entity: importedEntity, isNew } = await deps.createGlobalEntity({
		externalId,
		entitySchemaId,
		name: details.name,
		sandboxScriptId: scriptId,
	});

	await processRelatedEntities(
		{
			entityId: importedEntity.id,
			entitySchemaSlug: scope.slug,
			relatedEntities: details.relatedEntities,
		},
		deps,
	);

	const updatedEntity = await deps.updateGlobalEntityById({
		image,
		entitySchemaId,
		name: details.name,
		entityId: importedEntity.id,
		properties: validatedProperties,
		populatedAt:
			isNew || !importedEntity.populatedAt ? dayjs().toDate() : importedEntity.populatedAt,
	});

	if (linkToLibrary) {
		await upsertEntityInLibrary({ userId, entityId: importedEntity.id }, deps);
	}

	return updatedEntity;
};

const createEntityQueueJobId = (prefix: string, input: Record<string, unknown>) => {
	const hash = createHash("sha1").update(JSON.stringify(input)).digest("hex");
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
	if (!step) {
		const script = await deps.getSandboxScriptForUser({ userId, scriptId });
		if (!script) {
			throw new Error("Sandbox script not found");
		}

		await queueSandboxChildRun({
			job,
			childJobId: `${job.id}_sandbox`,
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

	const sandboxResult = await getSandboxChildRunResult(job);

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
				linkToLibrary: false,
			});
			return deps.addEntityQueueJob({
				payload,
				name: entityImportJobName,
				jobId: createEntityQueueJobId("entity_import", {
					scriptId,
					externalId,
					entitySchemaId,
					linkToLibrary: false,
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
