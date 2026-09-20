import { SandboxRunError } from "@ryot-app/contract/errors";
import { Effect, Layer } from "effect";

import { AuthRepository } from "#modules/auth/repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { ImportSourceCatalog } from "#modules/plugins/import-source-catalog";
import { IngestionReadinessService } from "#modules/plugins/ingestion-readiness-service";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionServiceLive } from "#modules/sandbox/layer";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { UploadServicesLive } from "#modules/uploads/layer";
import { IngestionPayloads } from "#modules/uploads/object-storage/ingestion-payloads";

import { IngestionArtifactStagingLive } from "./artifact-staging";
import { IngestionCaptures } from "./capture-service";
import { IngestionCaptureWorkflowDefinitionsLive } from "./capture-write-workflow";
import { DataImportAdmission } from "./data-admission";
import { DataImportWorkflowDefinitionsLive } from "./data-workflow";
import { IngestionExecution } from "./execution-service";
import { ProcessGenericImportChunksWorkflowDefinitionsLive } from "./generic-import-workflow";
import { ImportsRepository } from "./repository";
import { IngestionRetirement } from "./retirement-service";
import { ImportSourceStateStore } from "./runtime/source-state-store";
import { ImportsService } from "./service";
import { ImportWorkflowPinning } from "./workflow-pinning";

export const IngestionArtifactStagingProvidedLive = IngestionArtifactStagingLive.pipe(
	Layer.provide(Layer.mergeAll(ImportsRepository.layer, IngestionCaptures.layer)),
);

export const IngestionCaptureWorkflowDefinitionsProvidedLive =
	IngestionCaptureWorkflowDefinitionsLive.pipe(
		Layer.provide(Layer.mergeAll(ImportsRepository.layer, IngestionPayloads.layer)),
	);

export const ImportWorkflowPinningLive = Layer.effect(
	ImportWorkflowPinning,
	Effect.gen(function* () {
		const sandbox = yield* SandboxExecutionService;
		const repository = yield* ImportsRepository;
		return {
			release: sandbox.releaseWorkflowRegistration,
			preRegister: Effect.fn("ImportWorkflowPinning.preRegister")(function* (
				input: Parameters<ImportWorkflowPinning["Service"]["preRegister"]>[0],
			) {
				return yield* sandbox.preRegisterPluginWorkflow({
					...input,
					retain: (principal) =>
						Effect.gen(function* () {
							if (
								principal.scriptId !== input.expectedPins.scriptId ||
								principal.pluginRevision?.revisionId !== input.expectedPins.pluginRevisionId ||
								principal.pluginRevision.configRevisionId !==
									input.expectedPins.pluginConfigRevisionId ||
								input.executionId !== input.expectedPins.executionId
							) {
								return yield* new SandboxRunError({
									kind: "invalid-input",
									message: "Ingestion configuration changed before admission",
								});
							}
							yield* repository
								.reserveIngestionPins(
									input.scope,
									input.expectedPins,
									input.preparedRelease
										? {
												...input.preparedRelease,
												state: {
													...input.preparedRelease.state,
													pluginRevision: principal.pluginRevision,
												},
											}
										: undefined,
								)
								.pipe(
									Effect.mapError(
										(error) =>
											new SandboxRunError({ kind: "invalid-input", message: error.message }),
									),
								);
							return yield* Effect.void;
						}),
				});
			}),
		};
	}),
).pipe(Layer.provide(Layer.mergeAll(SandboxExecutionServiceLive, ImportsRepository.layer)));

export const IngestionExecutionLive = IngestionExecution.layer.pipe(
	Layer.provide(ImportWorkflowPinningLive),
);

export const IngestionRetirementLive = IngestionRetirement.layer.pipe(
	Layer.provide(
		Layer.mergeAll(IngestionExecutionLive, IngestionCaptures.layer, ImportsRepository.layer),
	),
);

export const DataImportAdmissionLive = DataImportAdmission.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ImportsRepository.layer,
			UploadServicesLive,
			IngestionCaptures.layer,
			IngestionPayloads.layer,
			IngestionExecutionLive,
		),
	),
);

export const DataImportWorkflowDefinitionsProvidedLive = DataImportWorkflowDefinitionsLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			DefinitionRepository.layer,
			EntitiesRepositoryLive,
			ImportsRepository.layer,
			PluginRuntimeResolverLive,
			UploadServicesLive,
			IngestionCaptures.layer,
			IngestionExecutionLive,
		),
	),
);

export const ImportsServiceLive = ImportsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			AuthRepository.layer,
			ImportsRepository.layer,
			UploadServicesLive,
			ImportSourceCatalog.layer,
			ImportSourceStateStore.layer,
			ImportWorkflowPinningLive,
			DataImportAdmissionLive,
			IngestionReadinessService.layer,
			PluginInstallationRepository.layer,
			IngestionExecutionLive,
		),
	),
);

export const ProcessGenericImportChunksWorkflowDefinitionsProvidedLive =
	ProcessGenericImportChunksWorkflowDefinitionsLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				DefinitionRepository.layer,
				EntitiesRepositoryLive,
				PluginRuntimeResolverLive,
				IngestionCaptures.layer,
				ImportsRepository.layer,
			),
		),
	);
