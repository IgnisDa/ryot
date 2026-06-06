import { DateTime, Effect, Either } from "effect";

import { DbRunner } from "~/lib/db";

import { ImportsRepository } from "../repository";
import {
	PROGRESS_UPDATE_INTERVAL,
	failImportRun,
	recordImportRunFailure,
	sanitizeErrorMessage,
} from "../runtime/failures";
import type { ImportRunFailureStage } from "../types";
import { populateMediaEntityRefs } from "./populate";
import { resolveMediaEntityRefs } from "./resolve";
import type { ImportMediaEntityGroup } from "./types";
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

export const processMediaImport = <E, R>(input: {
	runId: string;
	userId: string;
	sourceName: string;
	adapterErrorFallback: string;
	loadAdapterResult: Effect.Effect<MediaImportAdapterResult, E, R>;
}) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;

		const adapterResult = yield* input.loadAdapterResult.pipe(Effect.either);
		if (Either.isLeft(adapterResult)) {
			const message =
				typeof adapterResult.left === "string"
					? adapterResult.left
					: sanitizeErrorMessage(adapterResult.left, input.adapterErrorFallback);
			yield* failImportRun(input.runId, message);
			return;
		}

		const { entityGroups, failures } = adapterResult.right;

		for (const failure of failures) {
			yield* recordImportRunFailure({
				runId: input.runId,
				message: failure.message,
				itemIndex: failure.itemIndex,
				context: failure.context ?? null,
				sourceLabel: failure.sourceLabel,
				sourceIdentifier: failure.sourceIdentifier,
				stage: failure.stage ?? "input_transformation",
			});
		}

		const adapterFailureCount = failures.length;
		const groups = entityGroups.length;
		const totalItems = groups + adapterFailureCount;
		yield* runWithDb(repository.updateRun({ runId: input.runId, totalItems }));

		const makeReporter = (base: number, span: number) => {
			let last = -1;
			return (processed: number) =>
				Effect.gen(function* () {
					if (processed % PROGRESS_UPDATE_INTERVAL !== 0 && processed !== groups) {
						return;
					}
					const progress =
						groups > 0
							? Math.min(base + Math.round((processed / groups) * span), base + span)
							: base + span;
					if (progress === last) {
						return;
					}
					last = progress;
					yield* runWithDb(repository.updateRun({ runId: input.runId, progress }));
				});
		};

		const { resolveFailures } = yield* resolveMediaEntityRefs({
			entityGroups,
			runId: input.runId,
			userId: input.userId,
			onProgress: makeReporter(0, 30),
		});

		const { entityIdsByKey, populateFailures } = yield* populateMediaEntityRefs({
			entityGroups,
			runId: input.runId,
			userId: input.userId,
			onProgress: makeReporter(30, 60),
		});

		const { writeFailures, importedItems } = yield* writeMediaEntityGroups({
			entityGroups,
			entityIdsByKey,
			runId: input.runId,
			userId: input.userId,
			onProgress: makeReporter(90, 9),
		});

		const failedItems = adapterFailureCount + resolveFailures + populateFailures + writeFailures;
		const processedItems = adapterFailureCount + groups;

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
	});
