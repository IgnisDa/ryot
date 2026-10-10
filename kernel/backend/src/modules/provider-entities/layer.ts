import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SandboxExecutionServiceLive } from "#modules/sandbox/layer";

import { ProviderImportAdmission } from "./admission";
import { EntityImportWorkflowOperationsLive } from "./operations-workflow";
import { ProviderEntityPopulationWorkflowDefinitionsLive } from "./provider-entity-population-workflow";
import { ProviderEntitySearchService } from "./search-service";
import { EntityImportService } from "./service";

export const ProviderEntitySearchServiceLive = ProviderEntitySearchService.layer.pipe(
	Layer.provide(Layer.merge(SandboxExecutionServiceLive, PluginRuntimeResolverLive)),
);

export const EntityImportServiceLive = EntityImportService.layer.pipe(
	Layer.provide(Layer.merge(EntitiesRepositoryLive, PluginRuntimeResolverLive)),
	Layer.provide(ProviderImportAdmission.liveLayer),
);

export const EntityImportWorkflowOperationsProvidedLive = EntityImportWorkflowOperationsLive.pipe(
	Layer.provide(Layer.mergeAll(LifecycleServicesLive, SandboxExecutionServiceLive)),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);

export const ProviderEntityPopulationWorkflowDefinitionsProvidedLive =
	ProviderEntityPopulationWorkflowDefinitionsLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				DefinitionRepository.layer,
				EntitiesRepositoryLive,
				PluginRuntimeResolverLive,
				RelationshipsRepository.layer,
			),
		),
	);
