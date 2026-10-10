import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";

import { ProviderImportAdmission } from "./admission";
import { EntityImportWorkflowOperationsLive } from "./operations-workflow";
import { ProviderEntityPopulationWorkflowDefinitionsLive } from "./provider-entity-population-workflow";
import { ProviderEntitySearchService } from "./search-service";
import { EntityImportService } from "./service";

export const ProviderEntitySearchServiceLive = ProviderEntitySearchService.layer.pipe(
	Layer.provide(Layer.merge(ScriptExecutionServiceLive, PluginRuntimeResolverLive)),
);

export const EntityImportServiceLive = EntityImportService.layer.pipe(
	Layer.provide(Layer.merge(EntitiesRepositoryLive, PluginRuntimeResolverLive)),
	Layer.provide(
		ProviderImportAdmission.liveLayer.pipe(
			Layer.provide(
				Layer.mergeAll(
					ScriptExecutionServiceLive,
					PluginRuntimeResolverLive,
					DomainWriteChecksLive,
				),
			),
		),
	),
);

export const EntityImportWorkflowOperationsProvidedLive = EntityImportWorkflowOperationsLive.pipe(
	Layer.provide(
		Layer.mergeAll(LifecycleServicesLive, ScriptExecutionServiceLive, DomainWriteChecksLive),
	),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);

export const ProviderEntityPopulationWorkflowDefinitionsProvidedLive =
	ProviderEntityPopulationWorkflowDefinitionsLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				DefinitionRepository.layer,
				EntitiesRepositoryLive,
				DomainWriteChecksLive,
				PluginRuntimeResolverLive,
				RelationshipsRepository.layer,
			),
		),
	);
