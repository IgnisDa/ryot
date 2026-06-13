import type { ImportRunFailureReason } from "@ryot/contract/modules/imports/schemas";
import { Context, Effect, Layer } from "effect";
import { Activity } from "effect/unstable/workflow";

import { RedisService } from "#lib/infrastructure/redis";
import { UploadIntentsService } from "#modules/uploads/intents/service";

import type { ImportRunJobData } from "../jobs";
import { failImportRun } from "./import-run-status";
import { deleteImportSourceState } from "./source-state-store";
import { ImportRunError, toWorkflowError } from "./workflow-errors";

export class ImportRunArtifacts extends Context.Service<ImportRunArtifacts>()(
	"ImportRunArtifacts",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const uploads = yield* UploadIntentsService;

			const cleanupArtifacts = Effect.fn("imports.cleanupArtifacts")(function* (input: {
				claimId: string;
				sourceStateId: string;
			}) {
				yield* deleteImportSourceState(input.sourceStateId, input.claimId).pipe(
					Effect.provideService(RedisService, redis),
				);
			});

			const cleanupUploads = Effect.fn("imports.cleanupUploads")(function* (
				intentIds: ReadonlyArray<string>,
			) {
				yield* Effect.forEach(
					new Set(intentIds),
					(intentId) => uploads.deleteTemporaryUpload(intentId).pipe(Effect.ignore),
					{ discard: true },
				);
			});

			return { cleanupArtifacts, cleanupUploads };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const createImportRunLifecycle = (
	payload: Pick<ImportRunJobData, "runId" | "sourceStateId">,
	claimId: string,
) => {
	const cleanupArtifacts = (name: string) => {
		const cleanupEffect = Effect.gen(function* () {
			const artifacts = yield* ImportRunArtifacts;
			yield* artifacts.cleanupArtifacts({
				claimId,
				sourceStateId: payload.sourceStateId,
			});
		}).pipe(Effect.mapError(toWorkflowError));
		return Activity.make({ name, error: ImportRunError, execute: cleanupEffect });
	};
	const cleanupArtifactsBestEffort = (name: string) => {
		const cleanupBestEffortEffect = Effect.gen(function* () {
			const artifacts = yield* ImportRunArtifacts;
			yield* artifacts.cleanupArtifacts({
				claimId,
				sourceStateId: payload.sourceStateId,
			});
		}).pipe(Effect.ignore);
		return Activity.make({ name, execute: cleanupBestEffortEffect });
	};
	const cleanupUploadsBestEffort = (name: string, intentIds: ReadonlyArray<string>) => {
		const cleanupBestEffortEffect = Effect.gen(function* () {
			const artifacts = yield* ImportRunArtifacts;
			yield* artifacts.cleanupUploads(intentIds);
		}).pipe(Effect.ignore);
		return Activity.make({ name, execute: cleanupBestEffortEffect });
	};
	const markRunFailed = (name: string, reason: ImportRunFailureReason) => {
		const markFailedEffect = failImportRun(payload.runId, reason).pipe(
			Effect.mapError(toWorkflowError),
		);
		return Activity.make({ name, error: ImportRunError, execute: markFailedEffect });
	};

	const failRunAndCleanup = Effect.fn(function* (input: {
		cleanupName: string;
		failureName: string;
		uploadCleanupName: string;
		reason: ImportRunFailureReason;
		uploadIntentIds: ReadonlyArray<string>;
	}) {
		const failedRun = yield* Effect.exit(markRunFailed(input.failureName, input.reason));
		const cleanedUp = yield* Effect.exit(cleanupArtifacts(input.cleanupName));
		yield* cleanupUploadsBestEffort(input.uploadCleanupName, input.uploadIntentIds);

		if (cleanedUp._tag === "Failure") {
			return yield* Effect.failCause(cleanedUp.cause);
		}
		if (failedRun._tag === "Failure") {
			return yield* Effect.failCause(failedRun.cause);
		}

		return undefined;
	});

	return { failRunAndCleanup, cleanupUploadsBestEffort, cleanupArtifactsBestEffort };
};
