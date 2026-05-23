import type { Job } from "bullmq";

import { cleanupImportFile, readImportFile } from "../../files";
import type { ImportEntityRef, ImportMediaEntityGroup, ImportRunJobData } from "../../jobs";
import {
	entityRefKey,
	populateMediaEntityRefs,
	writeMediaEntityGroups,
} from "../../media/processor";
import { createImportRunFailure, updateImportRun } from "../../repository";
import type { ImportRunFailureStage } from "../../schemas";
import type { BookCsvAdapterResult } from "./shared";

const sanitizeErrorMessage = (error: unknown, fallback: string): string => {
	if (!(error instanceof Error)) {
		return fallback;
	}
	return error.message;
};

const recordItemFailure = async (
	runId: string,
	itemIndex: number,
	stage: ImportRunFailureStage,
	message: string,
	opts: {
		sourceLabel?: string | null;
		entitySchemaSlug?: string | null;
		sourceIdentifier?: string | null;
		context?: Record<string, unknown> | null;
	},
	createFailure: typeof createImportRunFailure,
): Promise<void> => {
	await createFailure({
		runId,
		stage,
		message,
		itemIndex,
		context: opts.context ?? null,
		sourceLabel: opts.sourceLabel ?? null,
		sourceIdentifier: opts.sourceIdentifier ?? null,
		entitySchemaSlug: opts.entitySchemaSlug ?? null,
	});
};

export type BookImportProcessorDeps = {
	readImportFile: typeof readImportFile;
	updateImportRun: typeof updateImportRun;
	cleanupImportFile: typeof cleanupImportFile;
	createImportRunFailure: typeof createImportRunFailure;
	writeMediaEntityGroups: typeof writeMediaEntityGroups;
	populateMediaEntityRefs: typeof populateMediaEntityRefs;
};

const bookImportProcessorDeps: BookImportProcessorDeps = {
	readImportFile,
	updateImportRun,
	cleanupImportFile,
	createImportRunFailure,
	writeMediaEntityGroups,
	populateMediaEntityRefs,
};

export const processBookCsvImport = async (
	job: Job,
	token: string | undefined,
	input: {
		runId: string;
		userId: string;
		filePath: string;
		sourceName: string;
		adapterFailureCount: number | undefined;
		providerEntityIndex: number | undefined;
		providerSandboxJobId: string | undefined;
		mediaWriteGroupIndex: number | undefined;
		mediaWriteFailedItems: number | undefined;
		importStep: ImportRunJobData["importStep"];
		mediaWriteImportedItems: number | undefined;
		providerFailedIndices: number[] | undefined;
		providerEntityRefs: ImportEntityRef[] | undefined;
		providerEntityIds: Array<string | null> | undefined;
		mediaEntityGroups: ImportMediaEntityGroup[] | undefined;
		adapt: (csvText: string) => Promise<BookCsvAdapterResult> | BookCsvAdapterResult;
	},
	deps: BookImportProcessorDeps = bookImportProcessorDeps,
): Promise<void> => {
	const { filePath, runId, userId } = input;

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
				let csvText: string;
				try {
					csvText = await deps.readImportFile(filePath);
				} catch {
					await deps.updateImportRun({
						runId,
						status: "failed",
						finishedAt: new Date(),
						errorSummary: "Could not read import file",
					});
					return;
				}

				let adapterResult: BookCsvAdapterResult;
				try {
					adapterResult = await input.adapt(csvText);
				} catch (error) {
					await deps.updateImportRun({
						runId,
						status: "failed",
						finishedAt: new Date(),
						errorSummary: sanitizeErrorMessage(
							error,
							`Could not parse ${input.sourceName} import data`,
						),
					});
					return;
				}

				for (const failure of adapterResult.failures) {
					// oxlint-disable-next-line no-await-in-loop
					await recordItemFailure(
						runId,
						failure.itemIndex,
						"input_transformation",
						failure.message,
						{
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
					runId,
					userId,
					filePath,
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
				jobData: { filePath },
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
				runId,
				userId,
				filePath,
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
			await deps.updateImportRun({
				runId,
				status: "failed",
				finishedAt: new Date(),
				errorSummary: `Import job is missing normalized or populated ${input.sourceName} data`,
			});
			return;
		}

		const entityIdsByKey = new Map<string, string>();
		providerEntityRefs.forEach((ref, index) => {
			const entityId = providerEntityIds[index];
			if (!providerFailedIndices.includes(index) && entityId) {
				entityIdsByKey.set(entityRefKey(ref), entityId);
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
					runId,
					userId,
					filePath,
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
		await deps.cleanupImportFile(filePath);
	}
};
