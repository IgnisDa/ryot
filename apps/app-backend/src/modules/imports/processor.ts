import type { AppSchema } from "@ryot/ts-utils/app-schema";
import { dayjs } from "@ryot/ts-utils/dayjs";

import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import { getTemporaryDirectory } from "~/lib/bun";
import { db } from "~/lib/db";
import { entity } from "~/lib/db/schema";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas";

import {
	cleanupImportFile,
	readImportFile,
	resolveSafeImportFilePath,
	validateFileExtension,
} from "./file-helpers";
import { createImportRunFailure, getImportRunById, updateImportRun } from "./repository";
import type { ImportRunFailureStage } from "./schemas";
import { adaptOpenScaleCsv } from "./sources/open-scale";
import type { OpenScaleNormalizedItem } from "./sources/open-scale";

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
): Promise<void> => {
	await createImportRunFailure({
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

const commitMeasurementEntity = async (
	userId: string,
	item: OpenScaleNormalizedItem,
	schemaId: string,
	propertiesSchema: AppSchema,
): Promise<void> => {
	const entityName = `Measurement - ${dayjs(item.properties.recordedAt).format("YYYY-MM-DD HH:mm")}`;

	const validatedProperties = parseAppSchemaProperties({
		kind: "Entity",
		properties: item.properties,
		propertiesSchema,
	});

	await db.insert(entity).values({
		userId,
		image: null,
		name: entityName,
		entitySchemaId: schemaId,
		properties: validatedProperties,
	});
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
				await commitMeasurementEntity(
					input.userId,
					item,
					measurementSchema.id,
					measurementSchema.propertiesSchema,
				);
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

export const processImportJob = async (input: {
	runId: string;
	userId: string;
	filePath: string;
}): Promise<void> => {
	const tempDir = getTemporaryDirectory();

	const run = await getImportRunById({ runId: input.runId, userId: input.userId });
	if (!run) {
		throw new Error(`Import run '${input.runId}' not found`);
	}

	await updateImportRun({ status: "running", runId: input.runId, startedAt: new Date() });

	const safePathResult = resolveSafeImportFilePath(input.filePath, tempDir);
	if ("error" in safePathResult) {
		await updateImportRun({
			status: "failed",
			runId: input.runId,
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
			status: "failed",
			runId: input.runId,
			finishedAt: new Date(),
			errorSummary: "Import job has an invalid file extension",
		});
		throw new Error("Import job has an invalid file extension");
	}

	try {
		if (run.source === "open_scale") {
			await processOpenScaleImport({
				runId: input.runId,
				userId: input.userId,
				filePath: safePath,
			});
		} else {
			await updateImportRun({
				status: "failed",
				runId: input.runId,
				finishedAt: new Date(),
				errorSummary: `Unsupported import source: ${run.source}`,
			});
		}
	} catch (error) {
		const message = sanitizeErrorMessage(error, "Import job failed unexpectedly");
		try {
			await updateImportRun({
				status: "failed",
				runId: input.runId,
				errorSummary: message,
				finishedAt: new Date(),
			});
		} catch {
			// best effort
		}
		throw error;
	}
};
