import { dayjs } from "@ryot/ts-utils/dayjs";

import { config } from "~/lib/config";
import { createEntity } from "~/modules/entities";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas";

import { updateImportRun } from "../repository";
import {
	PROGRESS_UPDATE_INTERVAL,
	failImportRun,
	recordImportRunFailure,
	sanitizeErrorMessage,
} from "../runtime/failures";
import { cleanupImportFile, readImportFile } from "../runtime/files";
import { adaptOpenScaleCsv, type OpenScaleNormalizedItem } from "../sources/open-scale/adapter";

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
			await failImportRun(input.runId, "Could not read import file");
			return;
		}

		let adapterResult: Awaited<ReturnType<typeof adaptOpenScaleCsv>>;
		try {
			adapterResult = adaptOpenScaleCsv(csvText, config.timezone);
		} catch (error) {
			await failImportRun(
				input.runId,
				sanitizeErrorMessage(error, "Could not parse OpenScale CSV"),
			);
			return;
		}

		const { items, failures: adapterFailures } = adapterResult;
		const totalItems = items.length + adapterFailures.length;

		await updateImportRun({ runId: input.runId, totalItems });

		const measurementSchema = await getBuiltinEntitySchemaBySlug("measurement");
		if (!measurementSchema) {
			await failImportRun(input.runId, "Measurement entity schema not found");
			return;
		}

		let failedItems = 0;
		let importedItems = 0;
		let processedItems = 0;

		// oxlint-disable no-await-in-loop
		for (const adapterFailure of adapterFailures) {
			await recordImportRunFailure({
				runId: input.runId,
				stage: "input_transformation",
				message: adapterFailure.message,
				itemIndex: adapterFailure.itemIndex,
				sourceLabel: adapterFailure.sourceLabel,
				sourceIdentifier: adapterFailure.sourceIdentifier,
			});
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
				await recordImportRunFailure({
					itemIndex,
					runId: input.runId,
					stage: "database_commit",
					sourceLabel: item.sourceLabel,
					entitySchemaSlug: "measurement",
					sourceIdentifier: item.sourceIdentifier,
					message: sanitizeErrorMessage(error, "Failed to create measurement entity"),
				});
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
