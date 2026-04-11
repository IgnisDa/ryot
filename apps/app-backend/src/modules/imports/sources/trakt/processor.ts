import type { Job } from "bullmq";

import { config } from "~/lib/config";

import type { ImportEntityRef, ImportMediaEntityGroup, ImportRunJobData } from "../../jobs";
import { createImportRunFailure, updateImportRun } from "../../repository";
import type { ImportRunFailureStage } from "../../schemas";
import { adaptTraktData } from "./adapter";
import { entityRefKey, populateMediaEntityRefs, writeMediaEntityGroups } from "./media-processor";

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
	opts?: {
		sourceLabel?: string | null;
		entitySchemaSlug?: string | null;
		sourceIdentifier?: string | null;
		context?: Record<string, unknown> | null;
	},
	createFailure: typeof createImportRunFailure = createImportRunFailure,
): Promise<void> => {
	await createFailure({
		runId,
		stage,
		message,
		itemIndex,
		context: opts?.context ?? null,
		sourceLabel: opts?.sourceLabel ?? null,
		sourceIdentifier: opts?.sourceIdentifier ?? null,
		entitySchemaSlug: opts?.entitySchemaSlug ?? null,
	});
};

export type TraktImportProcessorDeps = {
	adaptTraktData: typeof adaptTraktData;
	updateImportRun: typeof updateImportRun;
	getTraktClientId: () => string | undefined;
	createImportRunFailure: typeof createImportRunFailure;
	writeMediaEntityGroups: typeof writeMediaEntityGroups;
	populateMediaEntityRefs: typeof populateMediaEntityRefs;
};

const traktImportProcessorDeps: TraktImportProcessorDeps = {
	adaptTraktData,
	updateImportRun,
	createImportRunFailure,
	writeMediaEntityGroups,
	populateMediaEntityRefs,
	getTraktClientId: () => config.importer.trakt.clientId,
};

export const processTraktImport = async (
	job: Job,
	token: string | undefined,
	input: {
		runId: string;
		userId: string;
		traktUsername: string;
		providerEntityIndex: number | undefined;
		adapterFailureCount: number | undefined;
		providerSandboxJobId: string | undefined;
		mediaWriteGroupIndex: number | undefined;
		mediaWriteFailedItems: number | undefined;
		importStep: ImportRunJobData["importStep"];
		providerFailedIndices: number[] | undefined;
		mediaWriteImportedItems: number | undefined;
		providerEntityRefs: ImportEntityRef[] | undefined;
		providerEntityIds: Array<string | null> | undefined;
		mediaEntityGroups: ImportMediaEntityGroup[] | undefined;
	},
	deps: TraktImportProcessorDeps = traktImportProcessorDeps,
): Promise<void> => {
	const { runId, userId, traktUsername } = input;

	const clientId = deps.getTraktClientId();
	if (!clientId) {
		await deps.updateImportRun({
			runId,
			status: "failed",
			finishedAt: new Date(),
			errorSummary: "Trakt importer is not configured. Set SERVER_IMPORTER_TRAKT_CLIENT_ID.",
		});
		return;
	}

	let importStep = input.importStep;
	let mediaEntityGroups = input.mediaEntityGroups;
	let providerEntityRefs = input.providerEntityRefs;
	let adapterFailureCount = input.adapterFailureCount ?? 0;
	let mediaWriteFailedItems = input.mediaWriteFailedItems ?? 0;
	let mediaWriteGroupIndex = input.mediaWriteGroupIndex ?? 0;
	let mediaWriteImportedItems = input.mediaWriteImportedItems ?? 0;
	let providerEntityIds = input.providerEntityIds ?? [];
	let providerFailedIndices = input.providerFailedIndices ?? [];

	if (!importStep || importStep === "populating_entities") {
		if (!providerEntityRefs || !mediaEntityGroups) {
			let adapterResult: Awaited<ReturnType<typeof adaptTraktData>>;
			try {
				adapterResult = await deps.adaptTraktData(traktUsername, clientId);
			} catch (error) {
				await deps.updateImportRun({
					runId,
					status: "failed",
					finishedAt: new Date(),
					errorSummary: sanitizeErrorMessage(error, "Failed to fetch data from Trakt"),
				});
				return;
			}

			// oxlint-disable no-await-in-loop
			for (const failure of adapterResult.failures) {
				await recordItemFailure(
					runId,
					failure.itemIndex,
					"input_transformation",
					failure.message,
					{
						sourceLabel: failure.sourceLabel,
						sourceIdentifier: failure.sourceIdentifier,
					},
					deps.createImportRunFailure,
				);
			}
			// oxlint-enable no-await-in-loop

			mediaEntityGroups = adapterResult.entityGroups;
			adapterFailureCount = adapterResult.failures.length;
			mediaWriteFailedItems = 0;
			mediaWriteGroupIndex = 0;
			mediaWriteImportedItems = 0;
			providerEntityRefs = mediaEntityGroups.map((g) => g.entityRef);
			const totalItems = providerEntityRefs.length + adapterFailureCount;
			await deps.updateImportRun({ runId, totalItems });

			await job.updateData({
				runId,
				userId,
				traktUsername,
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

		const result = await deps.populateMediaEntityRefs(job, token, {
			runId,
			userId,
			traktUsername,
			mediaEntityGroups,
			adapterFailureCount,
			entityIds: providerEntityIds,
			entityRefs: providerEntityRefs,
			failedIndices: providerFailedIndices,
			startIndex: input.providerEntityIndex ?? 0,
			currentSandboxJobId: input.providerSandboxJobId,
		});
		// WaitingChildrenError propagates naturally to pause the job

		providerFailedIndices = result.failedIndices;
		providerEntityIds = result.entityIds;
		importStep = "writing_events";

		await job.updateData({
			runId,
			userId,
			traktUsername,
			mediaEntityGroups,
			providerEntityIds,
			providerEntityRefs,
			adapterFailureCount,
			mediaWriteGroupIndex,
			mediaWriteFailedItems,
			providerFailedIndices,
			mediaWriteImportedItems,
			importStep: "writing_events" as const,
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
			errorSummary: "Import job is missing normalized or populated Trakt data",
		});
		return;
	}

	const entityIdsByKey = new Map<string, string>();
	providerEntityRefs.forEach((ref, i) => {
		const entityId = providerEntityIds[i];
		if (!providerFailedIndices.includes(i) && entityId) {
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
			await job.updateData({
				runId,
				userId,
				traktUsername,
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
};
