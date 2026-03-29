import { Context, Effect, Layer } from "effect";
import { Activity } from "effect/unstable/workflow";

import { RedisService } from "#lib/infrastructure/redis";
import { UploadsService } from "#modules/uploads/service";

import type { ImportRunJobData } from "../jobs";
import { failImportRun } from "./import-run-status";
import { deleteImportSourcePayload } from "./source-payload-store";
import { ImportRunError, toWorkflowError } from "./workflow-errors";

export class ImportRunArtifacts extends Context.Service<ImportRunArtifacts>()(
	"ImportRunArtifacts",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const uploads = yield* UploadsService;

			const cleanupArtifacts = Effect.fn("imports.cleanupArtifacts")(function* (input: {
				sourcePayloadKey?: string | undefined;
			}) {
				if (input.sourcePayloadKey) {
					yield* deleteImportSourcePayload(input.sourcePayloadKey).pipe(
						Effect.provideService(RedisService, redis),
					);
				}
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
	payload: Pick<ImportRunJobData, "runId" | "sourcePayloadKey" | "uploadIntentIds">,
) => {
	const cleanupArtifacts = (name: string) => {
		const cleanupEffect = Effect.gen(function* () {
			const artifacts = yield* ImportRunArtifacts;
			yield* artifacts.cleanupArtifacts({
				sourcePayloadKey: payload.sourcePayloadKey,
			});
		}).pipe(Effect.mapError(toWorkflowError));
		return Activity.make({
			name,
			error: ImportRunError,
			execute: cleanupEffect,
		});
	};
	const cleanupArtifactsBestEffort = (name: string) => {
		const cleanupBestEffortEffect = Effect.gen(function* () {
			const artifacts = yield* ImportRunArtifacts;
			yield* artifacts.cleanupArtifacts({
				sourcePayloadKey: payload.sourcePayloadKey,
			});
		}).pipe(Effect.ignore);
		return Activity.make({ name, execute: cleanupBestEffortEffect });
	};
	const cleanupUploadsBestEffort = (name: string) => {
		const cleanupBestEffortEffect = Effect.gen(function* () {
			const artifacts = yield* ImportRunArtifacts;
			yield* artifacts.cleanupUploads(payload.uploadIntentIds ?? []);
		}).pipe(Effect.ignore);
		return Activity.make({ name, execute: cleanupBestEffortEffect });
	};
	const markRunFailed = (name: string, message: string) => {
		const markFailedEffect = failImportRun(payload.runId, message).pipe(
			Effect.mapError(toWorkflowError),
		);
		return Activity.make({ name, error: ImportRunError, execute: markFailedEffect });
	};

	const failRunAndCleanup = Effect.fn(function* (input: {
		message: string;
		cleanupName: string;
		failureName: string;
		uploadCleanupName: string;
	}) {
		const failedRun = yield* Effect.exit(markRunFailed(input.failureName, input.message));
		const cleanedUp = yield* Effect.exit(cleanupArtifacts(input.cleanupName));
		yield* cleanupUploadsBestEffort(input.uploadCleanupName);

		if (cleanedUp._tag === "Failure") {
			return yield* Effect.failCause(cleanedUp.cause);
		}
		if (failedRun._tag === "Failure") {
			return yield* Effect.failCause(failedRun.cause);
		}

		return undefined;
	});

	return {
		failRunAndCleanup,
		cleanupUploadsBestEffort,
		cleanupArtifactsBestEffort,
	};
};
