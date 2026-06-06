import type { Job } from "bullmq";

import { ensureEntityInLibrary } from "~/modules/entities";
import { populateGlobalEntity } from "~/modules/entities/population";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas";
import { getBuiltinSandboxScriptBySlug } from "~/modules/sandbox";

import type { ImportEntityRef, ImportMediaEntityGroup, ImportRunJobData } from "../jobs";
import { createImportRunFailure } from "../repository";

type MediaEntityPopulationDeps = {
	populateGlobalEntity: typeof populateGlobalEntity;
	ensureEntityInLibrary: typeof ensureEntityInLibrary;
	createImportRunFailure: typeof createImportRunFailure;
	getBuiltinEntitySchemaBySlug: typeof getBuiltinEntitySchemaBySlug;
	getBuiltinSandboxScriptBySlug: typeof getBuiltinSandboxScriptBySlug;
};

const mediaEntityPopulationDeps: MediaEntityPopulationDeps = {
	populateGlobalEntity,
	ensureEntityInLibrary,
	createImportRunFailure,
	getBuiltinEntitySchemaBySlug,
	getBuiltinSandboxScriptBySlug,
};

export const populateMediaEntityRefs = async (
	job: Job,
	token: string | undefined,
	input: {
		runId: string;
		userId: string;
		startIndex: number;
		failedIndices: number[];
		adapterFailureCount: number;
		entityRefs: ImportEntityRef[];
		entityIds: Array<string | null>;
		jobData?: Partial<ImportRunJobData>;
		currentSandboxJobId: string | undefined;
		mediaEntityGroups: ImportMediaEntityGroup[];
		onEntityProcessed?: (processedCount: number) => Promise<void>;
	},
	deps: MediaEntityPopulationDeps = mediaEntityPopulationDeps,
): Promise<{ failedIndices: number[]; entityIds: Array<string | null> }> => {
	const failedIndices = [...input.failedIndices];
	const entityIds = [...input.entityIds];
	while (entityIds.length < input.entityRefs.length) {
		entityIds.push(null);
	}

	const baseSnapshot = {
		...input.jobData,
		runId: input.runId,
		userId: input.userId,
		providerEntityIds: entityIds,
		providerEntityRefs: input.entityRefs,
		mediaEntityGroups: input.mediaEntityGroups,
		importStep: "populating_entities" as const,
		adapterFailureCount: input.adapterFailureCount,
	};
	const recordEntityProcessed = async (index: number) => {
		await input.onEntityProcessed?.(input.adapterFailureCount + (index + 1));
	};

	// oxlint-disable no-await-in-loop
	for (let i = input.startIndex; i < input.entityRefs.length; i++) {
		const ref = input.entityRefs[i];
		if (!ref) {
			await recordEntityProcessed(i);
			continue;
		}

		const script = await deps.getBuiltinSandboxScriptBySlug(ref.scriptSlug);
		if (!script) {
			failedIndices.push(i);
			entityIds[i] = null;
			await deps.createImportRunFailure({
				itemIndex: i,
				context: null,
				runId: input.runId,
				sourceLabel: ref.sourceLabel,
				stage: "input_transformation",
				sourceIdentifier: ref.externalId,
				entitySchemaSlug: ref.entitySchemaSlug,
				message: `Sandbox script not found for slug: ${ref.scriptSlug}`,
			});
			await job.updateData({
				...baseSnapshot,
				providerEntityIndex: i + 1,
				providerFailedIndices: failedIndices,
			});
			await recordEntityProcessed(i);
			continue;
		}

		const schema = await deps.getBuiltinEntitySchemaBySlug(ref.entitySchemaSlug);
		if (!schema) {
			failedIndices.push(i);
			entityIds[i] = null;
			await deps.createImportRunFailure({
				itemIndex: i,
				context: null,
				runId: input.runId,
				sourceLabel: ref.sourceLabel,
				stage: "input_transformation",
				sourceIdentifier: ref.externalId,
				entitySchemaSlug: ref.entitySchemaSlug,
				message: `Entity schema not found for slug: ${ref.entitySchemaSlug}`,
			});
			await job.updateData({
				...baseSnapshot,
				providerEntityIndex: i + 1,
				providerFailedIndices: failedIndices,
			});
			await recordEntityProcessed(i);
			continue;
		}

		const sandboxChildJobId = `${job.id}_sandbox_entity_${i}`;
		const sandboxAlreadyQueued = i === input.startIndex && input.currentSandboxJobId !== undefined;

		const updatedJobData = {
			...baseSnapshot,
			providerEntityIndex: i,
			providerFailedIndices: failedIndices,
			providerSandboxJobId: sandboxChildJobId,
		};

		const result = await deps.populateGlobalEntity(job, token, {
			updatedJobData,
			sandboxChildJobId,
			scriptId: script.id,
			userId: input.userId,
			sandboxAlreadyQueued,
			entitySchemaId: schema.id,
			externalId: ref.externalId,
		});

		if ("error" in result) {
			failedIndices.push(i);
			entityIds[i] = null;
			const failedGroup = input.mediaEntityGroups[i];
			await deps.createImportRunFailure({
				itemIndex: i,
				runId: input.runId,
				stage: "provider_details",
				sourceLabel: ref.sourceLabel,
				message: result.error.message,
				sourceIdentifier: ref.externalId,
				entitySchemaSlug: ref.entitySchemaSlug,
				context: failedGroup
					? {
							skippedEvents: failedGroup.events.length,
							skippedCollections: failedGroup.collectionMemberships.length,
						}
					: null,
			});
		} else {
			const libraryResult = await deps.ensureEntityInLibrary({
				userId: input.userId,
				entityId: result.entity.id,
			});
			if ("error" in libraryResult) {
				failedIndices.push(i);
				entityIds[i] = null;
				await deps.createImportRunFailure({
					itemIndex: i,
					context: null,
					runId: input.runId,
					stage: "database_commit",
					sourceLabel: ref.sourceLabel,
					message: libraryResult.message,
					sourceIdentifier: ref.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
				});
			} else {
				entityIds[i] = result.entity.id;
			}
		}

		await job.updateData({
			...baseSnapshot,
			providerEntityIndex: i + 1,
			providerEntityIds: entityIds,
			providerFailedIndices: failedIndices,
		});
		await recordEntityProcessed(i);
	}
	// oxlint-enable no-await-in-loop

	return { entityIds, failedIndices };
};
