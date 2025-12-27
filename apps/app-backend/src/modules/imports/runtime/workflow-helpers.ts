import { Activity } from "@effect/workflow";
import { Effect, Schema } from "effect";

import { unknownToMessage } from "~/lib/errors";

import type { ImportRunJobData } from "../jobs";
import { failImportRun } from "./failures";

export class ImportRunError extends Schema.TaggedError<ImportRunError>()("ImportRunError", {
	message: Schema.String,
}) {}

export const toWorkflowError = (cause: unknown) =>
	new ImportRunError({ message: unknownToMessage(cause) });

export const createImportRunLifecycle = <RCleanup>(
	payload: Pick<ImportRunJobData, "runId" | "sourcePayloadKey">,
	cleanupArtifactsEffect: (input: {
		sourcePayloadKey?: string;
		cleanupPaths: ReadonlyArray<string>;
	}) => Effect.Effect<void, unknown, RCleanup>,
) => {
	const cleanupArtifacts = (name: string, paths: ReadonlyArray<string>) =>
		Activity.make({
			name,
			error: ImportRunError,
			execute: cleanupArtifactsEffect({
				cleanupPaths: paths,
				sourcePayloadKey: payload.sourcePayloadKey,
			}).pipe(Effect.mapError(toWorkflowError)),
		});
	const cleanupArtifactsBestEffort = (name: string, paths: ReadonlyArray<string>) =>
		Activity.make({
			name,
			execute: cleanupArtifactsEffect({
				cleanupPaths: paths,
				sourcePayloadKey: payload.sourcePayloadKey,
			}).pipe(Effect.catchAll(() => Effect.void)),
		});

	const markRunFailed = (name: string, message: string) =>
		Activity.make({
			name,
			error: ImportRunError,
			execute: failImportRun(payload.runId, message).pipe(Effect.mapError(toWorkflowError)),
		});

	const failRunAndCleanup = (input: {
		message: string;
		cleanupName: string;
		failureName: string;
		cleanupPaths: ReadonlyArray<string>;
	}) =>
		Effect.gen(function* () {
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
