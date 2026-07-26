import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { Activity } from "effect/unstable/workflow";

import { AppConfig } from "#lib/infrastructure/config/service";
import { RedisService } from "#lib/infrastructure/redis";
import {
	removeSandboxHarvestDirectories,
	SANDBOX_HARVEST_DIRECTORY_PREFIX,
} from "#lib/infrastructure/sandbox-runtime/filesystem-grants";
import { ServerRun } from "#lib/infrastructure/server-run";
import { UploadsService } from "#modules/uploads/service";

import type { ImportRunJobData } from "../jobs";
import { failImportRun } from "./import-run-status";
import { deleteImportSourcePayload } from "./source-payload-store";
import { ImportRunError, toWorkflowError } from "./workflow-errors";

export class ImportRunArtifacts extends Context.Service<ImportRunArtifacts>()(
	"ImportRunArtifacts",
	{
		make: Effect.gen(function* () {
			const path = yield* Path.Path;
			const config = yield* AppConfig;
			const redis = yield* RedisService;
			const serverRun = yield* ServerRun;
			const uploads = yield* UploadsService;
			const fs = yield* FileSystem.FileSystem;
			const localTempRoot = yield* fs.realPath(config.fileStorage.localTempDir).pipe(Effect.orDie);

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

			const cleanupHarvestedDirectories = (executionPrefix: string) =>
				removeSandboxHarvestDirectories({
					executionPrefix,
					harvestRoot: path.join(
						localTempRoot,
						`${SANDBOX_HARVEST_DIRECTORY_PREFIX}${serverRun.id}`,
					),
				}).pipe(
					Effect.provideService(Path.Path, path),
					Effect.provideService(FileSystem.FileSystem, fs),
				);

			return { cleanupArtifacts, cleanupHarvestedDirectories, cleanupUploads };
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
	const cleanupHarvestedDirectoriesBestEffort = (name: string, executionPrefix: string) => {
		const cleanupBestEffortEffect = Effect.gen(function* () {
			const artifacts = yield* ImportRunArtifacts;
			yield* artifacts.cleanupHarvestedDirectories(executionPrefix);
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
		cleanupHarvestedDirectoriesBestEffort,
	};
};
