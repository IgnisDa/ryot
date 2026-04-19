import { WaitingChildrenError, type Job } from "bullmq";

import type { EventWriteContext } from "~/modules/events";

import { importEntityRefKey, type ImportMediaEntityGroup, type ImportRunJobData } from "../jobs";
import { createImportRunFailure, updateImportRun } from "../repository";
import { failImportRun, recordImportRunFailure, sanitizeErrorMessage } from "../runtime/failures";
import type { ImportRunFailureStage } from "../schemas";
import { populateMediaEntityRefs } from "./populate";
import { resolveMediaEntityRefs } from "./resolve";
import { writeMediaEntityGroups } from "./write";

export type MediaImportAdapterFailure = {
	message: string;
	itemIndex: number;
	sourceLabel?: string;
	sourceIdentifier?: string;
	stage?: ImportRunFailureStage;
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
	| "netflixSearchJobs"
	| "netflixMyListPath"
	| "netflixRatingsPath"
	| "providerEntityRefs"
	| "resolveEntityIndex"
	| "adapterFailureCount"
	| "providerEntityIndex"
	| "resolveSandboxJobId"
	| "providerSandboxJobId"
	| "mediaWriteGroupIndex"
	| "resolveFailedIndices"
	| "providerFailedIndices"
	| "resolveCandidateIndex"
	| "mediaWriteFailedItems"
	| "mediaWriteImportedItems"
	| "netflixViewingActivityPath"
	| "netflixExtractedDirectoryPath"
>;

export type MediaImportProcessorDeps = {
	updateImportRun: typeof updateImportRun;
	resolveMediaEntityRefs: typeof resolveMediaEntityRefs;
	createImportRunFailure: typeof createImportRunFailure;
	writeMediaEntityGroups: typeof writeMediaEntityGroups;
	populateMediaEntityRefs: typeof populateMediaEntityRefs;
};

const mediaImportProcessorDeps: MediaImportProcessorDeps = {
	updateImportRun,
	resolveMediaEntityRefs,
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
		writeContext?: EventWriteContext;
		jobData?: Partial<ImportRunJobData>;
		loadAdapterResult: () => Promise<MediaImportAdapterResult> | MediaImportAdapterResult;
	},
	deps: MediaImportProcessorDeps = mediaImportProcessorDeps,
): Promise<void> => {
	const { runId, userId } = input;
	const cleanupState = { shouldCleanup: true };

	try {
		let importStep = input.importStep;
		let mediaEntityGroups = input.mediaEntityGroups;
		let providerEntityRefs = input.providerEntityRefs;
		let providerEntityIds = input.providerEntityIds ?? [];
		let adapterFailureCount = input.adapterFailureCount ?? 0;
		let mediaWriteGroupIndex = input.mediaWriteGroupIndex ?? 0;
		let resolveFailedIndices = input.resolveFailedIndices ?? [];
		let mediaWriteFailedItems = input.mediaWriteFailedItems ?? 0;
		let providerFailedIndices = input.providerFailedIndices ?? [];
		let mediaWriteImportedItems = input.mediaWriteImportedItems ?? 0;

		if (!mediaEntityGroups) {
			let adapterResult: MediaImportAdapterResult;
			try {
				adapterResult = await input.loadAdapterResult();
			} catch (error) {
				if (error instanceof WaitingChildrenError) {
					cleanupState.shouldCleanup = false;
					throw error;
				}

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
						context: failure.context ?? null,
						sourceLabel: failure.sourceLabel,
						sourceIdentifier: failure.sourceIdentifier,
						stage: failure.stage ?? "input_transformation",
					},
					deps.createImportRunFailure,
				);
			}

			mediaWriteGroupIndex = 0;
			mediaWriteFailedItems = 0;
			resolveFailedIndices = [];
			mediaWriteImportedItems = 0;
			mediaEntityGroups = adapterResult.entityGroups;
			adapterFailureCount = adapterResult.failures.length;
			providerEntityRefs = mediaEntityGroups.map((group) => group.entityRef);

			const totalItems = providerEntityRefs.length + adapterFailureCount;
			await deps.updateImportRun({ runId, totalItems });

			importStep = "resolving_entities";
			await job.updateData({
				runId,
				userId,
				mediaEntityGroups,
				providerEntityRefs,
				adapterFailureCount,
				mediaWriteGroupIndex,
				providerEntityIds: [],
				resolveEntityIndex: 0,
				mediaWriteFailedItems,
				providerEntityIndex: 0,
				resolveCandidateIndex: 0,
				resolveFailedIndices: [],
				mediaWriteImportedItems,
				providerFailedIndices: [],
				importStep: "resolving_entities" as const,
			});
		}

		if (!providerEntityRefs) {
			await failImportRun(
				runId,
				`Import job is missing normalized ${input.sourceName} data`,
				deps.updateImportRun,
			);
			return;
		}

		if (!importStep || importStep === "resolving_entities") {
			const totalItems = providerEntityRefs.length + adapterFailureCount;
			const resolveResult = await deps.resolveMediaEntityRefs(job, token, {
				runId,
				userId,
				adapterFailureCount,
				entityGroups: mediaEntityGroups,
				failedIndices: resolveFailedIndices,
				currentSandboxJobId: input.resolveSandboxJobId,
				startEntityIndex: input.resolveEntityIndex ?? 0,
				startCandidateIndex: input.resolveCandidateIndex ?? 0,
				onEntityProcessed: async (processedCount) => {
					const progress = totalItems > 0 ? Math.round((processedCount / totalItems) * 30) : 0;
					await deps.updateImportRun({ runId, progress });
				},
			});

			importStep = "populating_entities";
			mediaEntityGroups = resolveResult.entityGroups;
			resolveFailedIndices = resolveResult.failedIndices;
			providerFailedIndices = resolveResult.failedIndices;
			providerEntityRefs = mediaEntityGroups.map((group) => group.entityRef);

			await job.updateData({
				runId,
				userId,
				importStep,
				mediaEntityGroups,
				providerEntityRefs,
				adapterFailureCount,
				mediaWriteGroupIndex,
				resolveFailedIndices,
				providerEntityIds: [],
				mediaWriteFailedItems,
				providerFailedIndices,
				providerEntityIndex: 0,
				mediaWriteImportedItems,
			});
		}

		if (importStep === "populating_entities") {
			const totalItems = providerEntityRefs.length + adapterFailureCount;
			const result = await deps.populateMediaEntityRefs(job, token, {
				runId,
				userId,
				mediaEntityGroups,
				adapterFailureCount,
				entityIds: providerEntityIds,
				entityRefs: providerEntityRefs,
				failedIndices: providerFailedIndices,
				startIndex: input.providerEntityIndex ?? 0,
				currentSandboxJobId: input.providerSandboxJobId,
				onEntityProcessed: async (processedCount) => {
					const progress =
						totalItems > 0 ? 30 + Math.round((processedCount / totalItems) * 60) : 30;
					await deps.updateImportRun({ runId, processedItems: processedCount, progress });
				},
			});

			importStep = "writing_events";
			providerEntityIds = result.entityIds;
			providerFailedIndices = result.failedIndices;

			await job.updateData({
				runId,
				userId,
				importStep,
				mediaEntityGroups,
				providerEntityIds,
				providerEntityRefs,
				adapterFailureCount,
				mediaWriteGroupIndex,
				resolveFailedIndices,
				mediaWriteFailedItems,
				providerFailedIndices,
				mediaWriteImportedItems,
			});
		}

		if (providerEntityIds.length < providerEntityRefs.length) {
			await failImportRun(
				runId,
				`Import job is missing populated ${input.sourceName} data`,
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
			writeContext: input.writeContext,
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
					runId,
					userId,
					mediaEntityGroups,
					providerEntityIds,
					providerEntityRefs,
					adapterFailureCount,
					mediaWriteGroupIndex,
					resolveFailedIndices,
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
		if (cleanupState.shouldCleanup) {
			await input.cleanup?.();
		}
	}
};
