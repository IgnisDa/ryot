import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import { sandboxSubjectUserId } from "@ryot-app/contract/modules/scripts/schemas";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { ExecutionFileStaging } from "@ryot-app/sandbox/host/execution-file-staging";
import { Effect, Layer } from "effect";

import { decodeScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";

import { IngestionCaptures } from "./capture-service";
import { ImportsRepository } from "./repository";

export const IngestionArtifactStagingLive = Layer.effect(
	ExecutionFileStaging,
	Effect.gen(function* () {
		const repository = yield* ImportsRepository;
		const captures = yield* IngestionCaptures;
		return {
			prepare: Effect.fn("imports.prepareArtifactStaging")(
				function* (input) {
					const subject = input.principal.subject;
					const ownerExecutionId = input.grants?.artifactOwnerExecutionId;
					if (!ownerExecutionId || !input.workflowExecutionId || subject.type === "system") {
						return null;
					}
					const userId = sandboxSubjectUserId(subject);
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
					const { pluginRevision } = yield* decodeScriptExecutionPrincipal(input.principal);
					if (
						run.pins?.pluginRevisionId !== (pluginRevision?.revisionId ?? null) ||
						run.pins.pluginConfigRevisionId !== (pluginRevision?.configRevisionId ?? null)
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
						outputs: ReadonlyArray<Uint8Array>,
					) {
						return yield* Effect.forEach(outputs, (bytes, outputIndex) =>
							Effect.gen(function* () {
								if (bytes.byteLength > 4 * 1024 * 1024) {
									return yield* new SandboxRunError({
										kind: "invalid-input",
										message: "Staged artifact exceeds its byte limit",
									});
								}
								return yield* captures.stage({
									scope,
									bytes,
									outputIndex,
									ownerExecutionId,
									workflowExecutionId,
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
