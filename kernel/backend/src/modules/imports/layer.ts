import { Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { ImportSourceCatalog } from "#modules/plugins/import-source-catalog";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionServiceLive } from "#modules/sandbox/layer";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { UploadServicesLive } from "#modules/uploads/layer";

import { ImportRunFailuresService } from "./failure-service";
import { ProcessGenericImportChunksWorkflowDefinitionsLive } from "./generic-import-workflow";
import { ImportsRepository } from "./repository";
import { ImportSourceStateStore } from "./runtime/source-state-store";
import { ImportsService } from "./service";
import { ImportWorkflowPinning } from "./workflow-pinning";

export const ImportWorkflowPinningLive = Layer.effect(
	ImportWorkflowPinning,
	Effect.gen(function* () {
		const sandbox = yield* SandboxExecutionService;
		return {
			release: sandbox.releaseWorkflowRegistration,
			preRegister: sandbox.preRegisterPluginWorkflow,
		};
	}),
).pipe(Layer.provide(SandboxExecutionServiceLive));

export const ImportsServiceLive = ImportsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ImportsRepository.layer,
			UploadServicesLive,
			ImportSourceCatalog.layer,
			ImportSourceStateStore.layer,
			ImportRunFailuresService.layer.pipe(Layer.provide(ImportsRepository.layer)),
			ImportWorkflowPinningLive,
		),
	),
);

export const ProcessGenericImportChunksWorkflowDefinitionsProvidedLive =
	ProcessGenericImportChunksWorkflowDefinitionsLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				DefinitionRepository.layer,
				EntitiesRepositoryLive,
				ImportRunFailuresService.layer.pipe(Layer.provide(ImportsRepository.layer)),
				PluginRuntimeResolverLive,
			),
		),
	);
