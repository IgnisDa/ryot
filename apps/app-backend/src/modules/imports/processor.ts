import { dayjs } from "@ryot/ts-utils/dayjs";
import { type Job, WaitingChildrenError } from "bullmq";

import { getTemporaryDirectory } from "~/lib/bun";
import { config } from "~/lib/config";
import { createEntity } from "~/modules/entities";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas";

import {
	cleanupImportFile,
	readImportFile,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "./file-helpers";
import type { ImportEntityRef, ImportMediaEntityGroup, ImportRunJobData } from "./jobs";
import { entityRefKey, populateMediaEntityRefs, writeMediaEntityGroups } from "./media-processor";
import { createImportRunFailure, getImportRunById, updateImportRun } from "./repository";
import type { ImportRunFailureStage } from "./schemas";
import { adaptOpenScaleCsv } from "./sources/open-scale";
import type { OpenScaleNormalizedItem } from "./sources/open-scale";
import { adaptTraktData } from "./sources/trakt";
import type { TraktAdapterResult } from "./sources/trakt";

const PROGRESS_UPDATE_INTERVAL = 10;

const allowedExtensionsBySource: Record<string, string[]> = {
	open_scale: ["csv"],
};

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

const commitMeasurementEntity = async (
	userId: string,
	item: OpenScaleNormalizedItem,
	schemaId: string,
): Promise<void> => {
	const entityName = `Measurement - ${dayjs(item.properties.recordedAt).format("YYYY-MM-DD HH:mm")}`;
	const result = await createEntity({
		userId,
		body: { image: null, name: entityName, entitySchemaId: schemaId, properties: item.properties },
	});
	if ("error" in result) {
		throw new Error(result.message);
	}
};

export const processOpenScaleImport = async (input: {
	runId: string;
	userId: string;
	filePath: string;
}): Promise<void> => {
	const safePath = input.filePath;

	try {
		let csvText: string;
		try {
			csvText = await readImportFile(safePath);
		} catch {
			await updateImportRun({
				status: "failed",
				runId: input.runId,
				finishedAt: new Date(),
				errorSummary: "Could not read import file",
			});
			return;
		}

		let adapterResult: Awaited<ReturnType<typeof adaptOpenScaleCsv>>;
		try {
			adapterResult = adaptOpenScaleCsv(csvText);
		} catch (error) {
			await updateImportRun({
				status: "failed",
				runId: input.runId,
				finishedAt: new Date(),
				errorSummary: sanitizeErrorMessage(error, "Could not parse OpenScale CSV"),
			});
			return;
		}

		const { items, failures: adapterFailures } = adapterResult;
		const totalItems = items.length + adapterFailures.length;

		await updateImportRun({ runId: input.runId, totalItems });

		const measurementSchema = await getBuiltinEntitySchemaBySlug("measurement");
		if (!measurementSchema) {
			await updateImportRun({
				status: "failed",
				runId: input.runId,
				finishedAt: new Date(),
				errorSummary: "Measurement entity schema not found",
			});
			return;
		}

		let failedItems = 0;
		let importedItems = 0;
		let processedItems = 0;

		// oxlint-disable no-await-in-loop
		for (const adapterFailure of adapterFailures) {
			await recordItemFailure(
				input.runId,
				adapterFailure.itemIndex,
				"input_transformation",
				adapterFailure.message,
				{
					sourceLabel: adapterFailure.sourceLabel,
					sourceIdentifier: adapterFailure.sourceIdentifier,
				},
			);
			failedItems++;
			processedItems++;
		}

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (!item) {
				continue;
			}

			const itemIndex = item.itemIndex;

			try {
				await commitMeasurementEntity(input.userId, item, measurementSchema.id);
				importedItems++;
			} catch (error) {
				await recordItemFailure(
					input.runId,
					itemIndex,
					"database_commit",
					sanitizeErrorMessage(error, "Failed to create measurement entity"),
					{
						sourceLabel: item.sourceLabel,
						entitySchemaSlug: "measurement",
						sourceIdentifier: item.sourceIdentifier,
					},
				);
				failedItems++;
			}

			processedItems++;

			if (processedItems % PROGRESS_UPDATE_INTERVAL === 0 || processedItems === totalItems) {
				const progress = totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 100;
				await updateImportRun({
					progress,
					failedItems,
					importedItems,
					processedItems,
					runId: input.runId,
				});
			}
		}

		// oxlint-enable no-await-in-loop
		await updateImportRun({
			failedItems,
			progress: 100,
			importedItems,
			processedItems,
			runId: input.runId,
			status: "completed",
			finishedAt: new Date(),
		});
	} finally {
		await cleanupImportFile(safePath);
	}
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
			let adapterResult: TraktAdapterResult;
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

export const processImportJob = async (input: {
	job: Job;
	runId: string;
	token?: string;
	userId: string;
	filePath?: string;
	traktUsername?: string;
	providerEntityIndex?: number;
	adapterFailureCount?: number;
	mediaWriteGroupIndex?: number;
	providerSandboxJobId?: string;
	mediaWriteFailedItems?: number;
	mediaWriteImportedItems?: number;
	providerFailedIndices?: number[];
	providerEntityRefs?: ImportEntityRef[];
	providerEntityIds?: Array<string | null>;
	importStep?: ImportRunJobData["importStep"];
	mediaEntityGroups?: ImportMediaEntityGroup[];
}): Promise<void> => {
	const { runId, userId } = input;

	const run = await getImportRunById({ runId, userId });
	if (!run) {
		throw new Error(`Import run '${runId}' not found`);
	}

	if (!input.importStep) {
		await updateImportRun({ status: "running", runId, startedAt: new Date() });
	}

	if (run.source === "trakt") {
		const traktUsername = input.traktUsername?.trim();
		if (!traktUsername) {
			await updateImportRun({
				runId,
				status: "failed",
				finishedAt: new Date(),
				errorSummary: "Import job is missing Trakt username",
			});
			throw new Error("Import job is missing Trakt username");
		}

		try {
			await processTraktImport(input.job, input.token, {
				runId,
				userId,
				traktUsername,
				importStep: input.importStep,
				mediaEntityGroups: input.mediaEntityGroups,
				providerEntityIds: input.providerEntityIds,
				providerEntityRefs: input.providerEntityRefs,
				providerEntityIndex: input.providerEntityIndex,
				adapterFailureCount: input.adapterFailureCount,
				providerSandboxJobId: input.providerSandboxJobId,
				mediaWriteGroupIndex: input.mediaWriteGroupIndex,
				providerFailedIndices: input.providerFailedIndices,
				mediaWriteFailedItems: input.mediaWriteFailedItems,
				mediaWriteImportedItems: input.mediaWriteImportedItems,
			});
		} catch (error) {
			if (error instanceof WaitingChildrenError) {
				throw error;
			}
			const message = sanitizeErrorMessage(error, "Import job failed unexpectedly");
			try {
				await updateImportRun({
					runId,
					status: "failed",
					errorSummary: message,
					finishedAt: new Date(),
				});
			} catch {}
			throw error;
		}
		return;
	}

	const tempDir = getTemporaryDirectory();

	const safePathResult = resolveSafeImportFilePath(input.filePath ?? "", tempDir);
	if ("error" in safePathResult) {
		await updateImportRun({
			runId,
			status: "failed",
			finishedAt: new Date(),
			errorSummary: "Import job has an invalid file path",
		});
		throw new Error("Import job has an invalid file path");
	}

	const safePath = safePathResult.path;

	const knownImportExtensions = [...new Set(Object.values(allowedExtensionsBySource).flat())];
	const extResult = validateFileExtension(safePath, knownImportExtensions);
	if ("error" in extResult) {
		await cleanupImportFile(safePath);
		await updateImportRun({
			runId,
			status: "failed",
			finishedAt: new Date(),
			errorSummary: "Import job has an invalid file extension",
		});
		throw new Error("Import job has an invalid file extension");
	}

	try {
		if (run.source === "open_scale") {
			await processOpenScaleImport({ runId, userId, filePath: safePath });
		} else {
			await updateImportRun({
				runId,
				status: "failed",
				finishedAt: new Date(),
				errorSummary: `Unsupported import source: ${run.source}`,
			});
		}
	} catch (error) {
		const message = sanitizeErrorMessage(error, "Import job failed unexpectedly");
		try {
			await updateImportRun({
				runId,
				status: "failed",
				errorSummary: message,
				finishedAt: new Date(),
			});
		} catch {
			// best effort
		}
		throw error;
	}
};
