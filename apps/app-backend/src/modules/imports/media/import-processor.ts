import type { Job } from "bullmq";

import { failImportRun, recordImportRunFailure, sanitizeErrorMessage } from "../helpers";
import { importEntityRefKey, type ImportMediaEntityGroup, type ImportRunJobData } from "../jobs";
import { createImportRunFailure, updateImportRun } from "../repository";
import { populateMediaEntityRefs, writeMediaEntityGroups } from "./processor";

export type MediaImportAdapterFailure = {
	message: string;
	itemIndex: number;
	sourceLabel?: string;
	sourceIdentifier?: string;
	context?: Record<string, unknown>;
};

export type MediaImportAdapterResult = {
	failures: MediaImportAdapterFailure[];
	entityGroups: ImportMediaEntityGroup[];
};

export type MediaImportJobInput = Pick<
	ImportRunJobData,
	| "runId"
	| "userId"
	| "importStep"
	| "providerEntityIds"
	| "mediaEntityGroups"
	| "providerEntityRefs"
	| "adapterFailureCount"
	| "providerEntityIndex"
	| "providerSandboxJobId"
	| "mediaWriteGroupIndex"
	| "providerFailedIndices"
	| "mediaWriteFailedItems"
	| "mediaWriteImportedItems"
>;

export type MediaImportProcessorDeps = {
	updateImportRun: typeof updateImportRun;
	createImportRunFailure: typeof createImportRunFailure;
	writeMediaEntityGroups: typeof writeMediaEntityGroups;
	populateMediaEntityRefs: typeof populateMediaEntityRefs;
};

const mediaImportProcessorDeps: MediaImportProcessorDeps = {
	updateImportRun,
	createImportRunFailure,
	writeMediaEntityGroups,
	populateMediaEntityRefs,
};

export const processMediaImport = async (
	job: Job,
	token: string | undefined,
	input: MediaImportJobInput & {
		sourceName: string;
		adapterErrorFallback: string;
		cleanup?: () => Promise<void>;
		jobData?: Partial<ImportRunJobData>;
		loadAdapterResult: () => Promise<MediaImportAdapterResult> | MediaImportAdapterResult;
	},
	deps: MediaImportProcessorDeps = mediaImportProcessorDeps,
): Promise<void> => {
	const { runId, userId } = input;

	try {
		let importStep = input.importStep;
		let mediaEntityGroups = input.mediaEntityGroups;
		let providerEntityRefs = input.providerEntityRefs;
		let providerEntityIds = input.providerEntityIds ?? [];
		let adapterFailureCount = input.adapterFailureCount ?? 0;
		let mediaWriteGroupIndex = input.mediaWriteGroupIndex ?? 0;
		let mediaWriteFailedItems = input.mediaWriteFailedItems ?? 0;
		let providerFailedIndices = input.providerFailedIndices ?? [];
		let mediaWriteImportedItems = input.mediaWriteImportedItems ?? 0;

		if (!importStep || importStep === "populating_entities") {
			if (!providerEntityRefs || !mediaEntityGroups) {
				let adapterResult: MediaImportAdapterResult;
				try {
					adapterResult = await input.loadAdapterResult();
				} catch (error) {
					await failImportRun(
						runId,
						sanitizeErrorMessage(error, input.adapterErrorFallback),
						deps.updateImportRun,
					);
					return;
				}

				for (const failure of adapterResult.failures) {
					// oxlint-disable-next-line no-await-in-loop
					await recordImportRunFailure(
						{
							runId,
							message: failure.message,
							itemIndex: failure.itemIndex,
							stage: "input_transformation",
							context: failure.context ?? null,
							sourceLabel: failure.sourceLabel,
							sourceIdentifier: failure.sourceIdentifier,
						},
						deps.createImportRunFailure,
					);
				}

				mediaEntityGroups = adapterResult.entityGroups;
				adapterFailureCount = adapterResult.failures.length;
				mediaWriteFailedItems = 0;
				mediaWriteGroupIndex = 0;
				mediaWriteImportedItems = 0;
				providerEntityRefs = mediaEntityGroups.map((group) => group.entityRef);
				const totalItems = providerEntityRefs.length + adapterFailureCount;
				await deps.updateImportRun({ runId, totalItems });

				await job.updateData({
					...input.jobData,
					runId,
					userId,
					mediaEntityGroups,
					providerEntityRefs,
					adapterFailureCount,
					mediaWriteGroupIndex,
					providerEntityIds: [],
					mediaWriteFailedItems,
					providerEntityIndex: 0,
					mediaWriteImportedItems,
					providerFailedIndices: [],
					importStep: "populating_entities" as const,
				});
			}

			const totalItems = providerEntityRefs.length + adapterFailureCount;
			const result = await deps.populateMediaEntityRefs(job, token, {
				runId,
				userId,
				mediaEntityGroups,
				adapterFailureCount,
				jobData: input.jobData,
				entityIds: providerEntityIds,
				entityRefs: providerEntityRefs,
				failedIndices: providerFailedIndices,
				startIndex: input.providerEntityIndex ?? 0,
				currentSandboxJobId: input.providerSandboxJobId,
				onEntityProcessed: async (processedCount) => {
					const progress = totalItems > 0 ? Math.round((processedCount / totalItems) * 90) : 0;
					await deps.updateImportRun({ runId, processedItems: processedCount, progress });
				},
			});

			providerFailedIndices = result.failedIndices;
			providerEntityIds = result.entityIds;
			importStep = "writing_events";

			await job.updateData({
				...input.jobData,
				runId,
				userId,
				importStep,
				mediaEntityGroups,
				providerEntityIds,
				providerEntityRefs,
				adapterFailureCount,
				mediaWriteGroupIndex,
				mediaWriteFailedItems,
				providerFailedIndices,
				mediaWriteImportedItems,
			});
		}

		if (
			!mediaEntityGroups ||
			!providerEntityRefs ||
			providerEntityIds.length < providerEntityRefs.length
		) {
			await failImportRun(
				runId,
				`Import job is missing normalized or populated ${input.sourceName} data`,
				deps.updateImportRun,
			);
			return;
		}

		const entityIdsByKey = new Map<string, string>();
		providerEntityRefs.forEach((ref, index) => {
			const entityId = providerEntityIds[index];
			if (!providerFailedIndices.includes(index) && entityId) {
				entityIdsByKey.set(importEntityRefKey(ref), entityId);
			}
		});

		const { failedItems, importedItems } = await deps.writeMediaEntityGroups({
			runId,
			userId,
			entityIdsByKey,
			entityGroups: mediaEntityGroups,
			failedItems: mediaWriteFailedItems,
			startGroupIndex: mediaWriteGroupIndex,
			importedItems: mediaWriteImportedItems,
			onGroupComplete: async (state) => {
				mediaWriteFailedItems = state.failedItems;
				mediaWriteGroupIndex = state.nextGroupIndex;
				mediaWriteImportedItems = state.importedItems;
				const processedSoFar = adapterFailureCount + providerEntityRefs.length;
				const writtenSoFar = state.nextGroupIndex;
				const writeProgress =
					mediaEntityGroups.length > 0
						? Math.round((writtenSoFar / mediaEntityGroups.length) * 10)
						: 0;
				const progress = Math.min(90 + writeProgress, 99);
				await deps.updateImportRun({
					runId,
					progress,
					processedItems: processedSoFar,
					importedItems: state.importedItems,
					failedItems: adapterFailureCount + providerFailedIndices.length + state.failedItems,
				});
				await job.updateData({
					...input.jobData,
					runId,
					userId,
					mediaEntityGroups,
					providerEntityIds,
					providerEntityRefs,
					adapterFailureCount,
					mediaWriteGroupIndex,
					providerFailedIndices,
					mediaWriteFailedItems,
					mediaWriteImportedItems,
					importStep: "writing_events" as const,
				});
			},
		});

		const totalFailed = adapterFailureCount + providerFailedIndices.length + failedItems;
		const totalProcessed = adapterFailureCount + providerEntityRefs.length;

		await deps.updateImportRun({
			runId,
			importedItems,
			progress: 100,
			status: "completed",
			finishedAt: new Date(),
			failedItems: totalFailed,
			processedItems: totalProcessed,
		});
	} finally {
		await input.cleanup?.();
	}
};
