import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { Activity } from "effect/unstable/workflow";

import { AppConfig } from "#lib/infrastructure/config/service";
import { RedisService } from "#lib/infrastructure/redis";
import {
	removeSandboxHarvestDirectories,
	SANDBOX_HARVEST_DIRECTORY_PREFIX,
} from "#lib/infrastructure/sandbox-runtime/filesystem-grants";
import { ServerRun } from "#lib/infrastructure/server-run";

import type { ImportRunJobData } from "../jobs";
import { resolveSafeImportFilePath } from "./import-files";
import { failImportRun } from "./import-run-status";
import { deleteImportSourcePayload } from "./source-payload-store";
import { ImportRunError, toWorkflowError } from "./workflow-errors";

export class ImportRunArtifacts extends Context.Service<ImportRunArtifacts>()(
	"ImportRunArtifacts",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const redis = yield* RedisService;
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const serverRun = yield* ServerRun;

			const cleanupArtifacts = Effect.fn("imports.cleanupArtifacts")(function* (input: {
				runId?: string | undefined;
				sourcePayloadKey?: string | undefined;
				cleanupPaths: ReadonlyArray<string>;
			}) {
				if (input.sourcePayloadKey) {
					yield* deleteImportSourcePayload(input.sourcePayloadKey).pipe(
						Effect.provideService(RedisService, redis),
					);
				}

				yield* Effect.forEach(
					new Set(input.cleanupPaths),
					(cleanupPath) =>
						!cleanupPath.trim()
							? Effect.void
							: resolveSafeImportFilePath(cleanupPath, config.fileStorage.localTempDir).pipe(
									Effect.mapError(
										() => new ImportRunError({ message: "Import cleanup path is invalid" }),
									),
									Effect.flatMap((safePath) => fs.remove(safePath, { recursive: true })),
								),
					{ discard: true },
				);
			});

			const cleanupHarvestedDirectories = (executionPrefix: string) =>
				removeSandboxHarvestDirectories({
					executionPrefix,
					harvestRoot: path.join(
						config.fileStorage.localTempDir,
						`${SANDBOX_HARVEST_DIRECTORY_PREFIX}${serverRun.id}`,
					),
				}).pipe(
					Effect.provideService(Path.Path, path),
					Effect.provideService(FileSystem.FileSystem, fs),
				);

			return { cleanupArtifacts, cleanupHarvestedDirectories };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const createImportRunLifecycle = (
	payload: Pick<ImportRunJobData, "runId" | "sourcePayloadKey">,
) => {
	const cleanupArtifacts = (name: string, paths: ReadonlyArray<string>) => {
		const cleanupEffect = Effect.gen(function* () {
			const artifacts = yield* ImportRunArtifacts;
			yield* artifacts.cleanupArtifacts({
				cleanupPaths: paths,
				runId: payload.runId,
				sourcePayloadKey: payload.sourcePayloadKey,
			});
		}).pipe(Effect.mapError(toWorkflowError));
		return Activity.make({
			name,
			error: ImportRunError,
			execute: cleanupEffect,
		});
	};
	const cleanupArtifactsBestEffort = (name: string, paths: ReadonlyArray<string>) => {
		const cleanupBestEffortEffect = Effect.gen(function* () {
			const artifacts = yield* ImportRunArtifacts;
			yield* artifacts.cleanupArtifacts({
				cleanupPaths: paths,
				runId: payload.runId,
				sourcePayloadKey: payload.sourcePayloadKey,
			});
		}).pipe(Effect.ignore);
		return Activity.make({
			name,
			execute: cleanupBestEffortEffect,
		});
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
		return Activity.make({
			name,
			error: ImportRunError,
			execute: markFailedEffect,
		});
	};

	const failRunAndCleanup = Effect.fn(function* (input: {
		message: string;
		cleanupName: string;
		failureName: string;
		cleanupPaths: ReadonlyArray<string>;
	}) {
		const failedRun = yield* Effect.exit(markRunFailed(input.failureName, input.message));
		const cleanedUp = yield* Effect.exit(cleanupArtifacts(input.cleanupName, input.cleanupPaths));

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
		cleanupArtifactsBestEffort,
		cleanupHarvestedDirectoriesBestEffort,
	};
};
