import { Layer } from "effect";

import { LifecycleServicesLive } from "#modules/automations/layer";
import { EventSchemaReaderLive } from "#modules/definitions/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { TranslationsServiceLive } from "#modules/entities/localization/layer";
import { EntityPopulation } from "#modules/entities/populate";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EntityRetentionRepository } from "#modules/entities/retention/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RyotQLService } from "#modules/ryotql/service";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";

import { ProviderImportAdmission } from "./admission";
import { EntityEnrichmentService } from "./enrichment";
import { EntityImportWorkflowOperationsLive } from "./operations-workflow";
import { EntityPopulationJobLive } from "./population-job";
import { EntityPopulationTriggerLive } from "./population-trigger-live";
import { ProviderEntitySearchService } from "./search-service";
import { EntityImportService } from "./service";

export const ProviderEntitySearchServiceLive = ProviderEntitySearchService.layer.pipe(
	Layer.provide(Layer.merge(ScriptExecutionServiceLive, PluginRuntimeResolverLive)),
);

export const EntityImportServiceLive = EntityImportService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(EntitiesRepositoryLive, PluginRuntimeResolverLive, EventSchemaReaderLive),
	),
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

export const EntityEnrichmentServiceLive = EntityEnrichmentService.layer.pipe(
	Layer.provide(
		EntityPopulationTriggerLive.pipe(
			Layer.provide(Layer.merge(ScriptExecutionServiceLive, DomainWriteChecksLive)),
			Layer.provide(EnrichmentRequests.layer),
		),
	),
	Layer.provide(Layer.merge(EntitiesRepositoryLive, PluginRuntimeResolverLive)),
	Layer.provide(Layer.merge(EnrichmentRequests.layer, TranslationsServiceLive)),
);

export const EntityPopulationLive = EntityPopulation.layer.pipe(
	Layer.provide(
		EntityPopulationTriggerLive.pipe(
			Layer.provide(Layer.merge(ScriptExecutionServiceLive, DomainWriteChecksLive)),
			Layer.provide(EnrichmentRequests.layer),
		),
	),
	Layer.provide(
		Layer.mergeAll(
			RyotQLService.layer,
			TranslationsServiceLive,
			DefinitionRepository.layer,
			EntityRetentionRepository.layer,
		),
	),
	Layer.provide(PluginRuntimeResolverLive),
);

export const EntityImportWorkflowOperationsProvidedLive = EntityImportWorkflowOperationsLive.pipe(
	Layer.provide(
		Layer.mergeAll(LifecycleServicesLive, ScriptExecutionServiceLive, DomainWriteChecksLive),
	),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);

export const EntityPopulationJobProvidedLive = EntityPopulationJobLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			DefinitionRepository.layer,
			EntitiesRepositoryLive,
			TranslationsServiceLive,
			DomainWriteChecksLive,
			PluginRuntimeResolverLive,
			RelationshipsRepository.layer,
			EnrichmentRequests.layer,
		),
	),
);
