import { FileSystem } from "@effect/platform";
import { Activity } from "@effect/workflow";
import { Effect, Schema } from "effect";

import { AppConfig } from "#lib/config";
import { unknownToMessage } from "#lib/errors";
import { RedisService } from "#lib/redis";

import type { ImportRunJobData } from "../jobs";
import { resolveSafeImportFilePath } from "./import-files";
import { failImportRun } from "./import-run-status";
import { deleteImportSourcePayload } from "./source-payload-store";

export class ImportRunError extends Schema.TaggedError<ImportRunError>()("ImportRunError", {
	message: Schema.String,
}) {}

export const toWorkflowError = (cause: unknown) =>
	new ImportRunError({ message: unknownToMessage(cause) });

export class ImportRunArtifacts extends Effect.Service<ImportRunArtifacts>()("ImportRunArtifacts", {
	effect: Effect.gen(function* () {
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const fs = yield* FileSystem.FileSystem;

		const cleanupArtifacts = Effect.fn("imports.cleanupArtifacts")(function* (input: {
			sourcePayloadKey?: string;
			cleanupPaths: ReadonlyArray<string>;
		}) {
			if (input.sourcePayloadKey) {
				yield* deleteImportSourcePayload(input.sourcePayloadKey).pipe(
					Effect.provideService(RedisService, redis),
				);
			}

			yield* Effect.forEach(
				new Set(input.cleanupPaths),
				(path) =>
					!path.trim()
						? Effect.void
						: resolveSafeImportFilePath(path, config.tmpDir).pipe(
								Effect.mapError(
									() => new ImportRunError({ message: "Import cleanup path is invalid" }),
								),
								Effect.flatMap((safePath) => fs.remove(safePath, { recursive: true })),
							),
				{ discard: true },
			);
		});

		return { cleanupArtifacts };
	}),
}) {}

export const createImportRunLifecycle = (
	payload: Pick<ImportRunJobData, "runId" | "sourcePayloadKey">,
) => {
	const cleanupArtifacts = (name: string, paths: ReadonlyArray<string>) =>
		Activity.make({
			name,
			error: ImportRunError,
			execute: Effect.gen(function* () {
				const artifacts = yield* ImportRunArtifacts;
				yield* artifacts.cleanupArtifacts({
					cleanupPaths: paths,
					sourcePayloadKey: payload.sourcePayloadKey,
				});
			}).pipe(Effect.mapError(toWorkflowError)),
		});
	const cleanupArtifactsBestEffort = (name: string, paths: ReadonlyArray<string>) =>
		Activity.make({
			name,
			execute: Effect.gen(function* () {
				const artifacts = yield* ImportRunArtifacts;
				yield* artifacts.cleanupArtifacts({
					cleanupPaths: paths,
					sourcePayloadKey: payload.sourcePayloadKey,
				});
			}).pipe(Effect.catchAll(() => Effect.void)),
		});

	const markRunFailed = (name: string, message: string) =>
		Activity.make({
			name,
			error: ImportRunError,
			execute: failImportRun(payload.runId, message).pipe(Effect.mapError(toWorkflowError)),
		});

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

	return { cleanupArtifacts, failRunAndCleanup, cleanupArtifactsBestEffort };
};
