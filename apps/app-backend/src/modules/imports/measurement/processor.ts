import { DateTime, Effect, Either } from "effect";

import type { CurrentUserValue } from "~/lib/auth";
import { DbRunner } from "~/lib/db";
import { EntitiesService } from "~/modules/entities/service";
import { EntitySchemasRepository } from "~/modules/entity-schemas/repository";

import { ImportsRepository } from "../repository";
import {
	PROGRESS_UPDATE_INTERVAL,
	failImportRun,
	recordImportRunFailure,
	sanitizeErrorMessage,
} from "../runtime/failures";
import { cleanupImportFile, readImportFile } from "../runtime/files";
import { adaptOpenScaleCsv } from "../sources/open-scale/adapter";

export const processOpenScaleImport = (input: {
	runId: string;
	userId: string;
	filePath: string;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const entities = yield* EntitiesService;
		const repository = yield* ImportsRepository;
		const entitySchemas = yield* EntitySchemasRepository;

		const user: CurrentUserValue = { id: input.userId, name: "", email: "" };

		const csvText = yield* readImportFile(input.filePath).pipe(Effect.either);
		if (Either.isLeft(csvText)) {
			yield* failImportRun(input.runId, "Could not read import file");
			return;
		}

		const adapterResult = yield* Effect.try({
			try: () => adaptOpenScaleCsv(csvText.right),
			catch: (error) => sanitizeErrorMessage(error, "Could not parse OpenScale CSV"),
		}).pipe(Effect.either);
		if (Either.isLeft(adapterResult)) {
			yield* failImportRun(input.runId, adapterResult.left);
			return;
		}

		const { items, failures: adapterFailures } = adapterResult.right;
		const totalItems = items.length + adapterFailures.length;

		yield* runWithDb(repository.updateRun({ runId: input.runId, totalItems }));

		const measurementSchema = yield* runWithDb(entitySchemas.getBuiltinBySlug("measurement"));
		if (!measurementSchema) {
			yield* failImportRun(input.runId, "Measurement entity schema not found");
			return;
		}

		let failedItems = 0;
		let importedItems = 0;
		let processedItems = 0;

		for (const adapterFailure of adapterFailures) {
			yield* recordImportRunFailure({
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

		for (const item of items) {
			const created = yield* entities
				.create(user, {
					properties: item.properties,
					entitySchemaId: measurementSchema.id,
					name: `Measurement - ${item.sourceLabel}`,
				})
				.pipe(Effect.either);

			if (Either.isRight(created)) {
				importedItems++;
			} else {
				yield* recordImportRunFailure({
					runId: input.runId,
					stage: "database_commit",
					itemIndex: item.itemIndex,
					sourceLabel: item.sourceLabel,
					entitySchemaSlug: "measurement",
					sourceIdentifier: item.sourceIdentifier,
					message: sanitizeErrorMessage(created.left, "Failed to create measurement entity"),
				});
				failedItems++;
			}

			processedItems++;

			if (processedItems % PROGRESS_UPDATE_INTERVAL === 0 || processedItems === totalItems) {
				const progress = totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 100;
				yield* runWithDb(
					repository.updateRun({
						progress,
						failedItems,
						importedItems,
						processedItems,
						runId: input.runId,
					}),
				);
			}
		}

		const finishedAt = yield* DateTime.nowAsDate;
		yield* runWithDb(
			repository.updateRun({
				finishedAt,
				failedItems,
				progress: 100,
				importedItems,
				processedItems,
				runId: input.runId,
				status: "completed",
			}),
		);
	}).pipe(Effect.ensuring(cleanupImportFile(input.filePath)));
