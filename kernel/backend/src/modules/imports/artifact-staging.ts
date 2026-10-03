import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Effect, FileSystem, Layer } from "effect";

import { SandboxArtifactStaging } from "#lib/infrastructure/sandbox-runtime/artifact-staging";

import { IngestionCaptures } from "./capture-service";
import { ImportsRepository } from "./repository";

export const IngestionArtifactStagingLive = Layer.effect(
	SandboxArtifactStaging,
	Effect.gen(function* () {
		const repository = yield* ImportsRepository;
		const captures = yield* IngestionCaptures;
		const fs = yield* FileSystem.FileSystem;
		return {
			prepare: Effect.fn("imports.prepareArtifactStaging")(
				function* (input) {
					const subject = input.principal.subject;
					const ownerExecutionId = input.grants?.artifactOwnerExecutionId;
					if (!ownerExecutionId || !input.workflowExecutionId || subject.type === "system") {
						return null;
					}
					const userId = subject.type === "user" ? subject.userId : subject.executionUserId;
					if (!userId || !subject.accountGeneration) {
						return null;
					}
					const run = yield* repository.getStagingOwner(
						userId,
						subject.accountGeneration,
						ownerExecutionId,
					);
					if (!run) {
						return null;
					}
					if (run.status !== "running") {
						return yield* new SandboxRunError({
							kind: "invalid-input",
							message: "Staged artifact owner is not running",
						});
					}
					if (
						run.pins?.pluginRevisionId !== (input.principal.pluginRevision?.revisionId ?? null) ||
						run.pins.pluginConfigRevisionId !==
							(input.principal.pluginRevision?.configRevisionId ?? null)
					) {
						return yield* new SandboxRunError({
							kind: "invalid-input",
							message: "Staged artifact execution pins changed",
						});
					}
					const scope = {
						userId,
						runId: ImportRunId.make(run.id),
						accountGeneration: subject.accountGeneration,
					};
					const workflowExecutionId = input.workflowExecutionId;
					return Effect.fn("imports.stageHarvestedArtifacts")(function* (
						sources: ReadonlyArray<string>,
					) {
						return yield* Effect.forEach(sources, (source, outputIndex) =>
							Effect.gen(function* () {
								if (Number((yield* fs.stat(source)).size) > 4 * 1024 * 1024) {
									return yield* new SandboxRunError({
										kind: "invalid-input",
										message: "Staged artifact exceeds its byte limit",
									});
								}
								return yield* captures.stage({
									scope,
									outputIndex,
									ownerExecutionId,
									workflowExecutionId,
									bytes: yield* fs.readFile(source),
									activityExecutionId: input.executionId,
								});
							}),
						).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
							),
						);
					});
				},
				(effect) =>
					effect.pipe(
						Effect.mapError(
							(error) =>
								new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
						),
					),
			),
		};
	}),
);
