import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { RelationshipSchemaReaderLive } from "#modules/definitions/layer";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { TranslationsRepository } from "#modules/entities/localization/repository";
import { InterestServicesLive } from "#modules/entities/watches/layer";
import { ImportsServiceLive, IngestionExecutionLive } from "#modules/imports/layer";
import { ImportsRepository } from "#modules/imports/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { PluginIngestionServiceLive, PluginInstallationRuntimeLive } from "#modules/plugins/layer";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { RelationshipsServiceLive } from "#modules/relationships/layer";
import { PluginCronServiceLive } from "#modules/scheduler/layer";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";

import { OperationalGateRepository } from "./operational-gate-repository";
import { OperationalGateService } from "./operational-gate-service";
import { TestSupportService } from "./service";

export const TestSupportServicesLive = Layer.merge(
	TestSupportService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				AuthServiceLive,
				EntitiesServiceRuntimeLive,
				InterestServicesLive,
				PluginCronServiceLive,
				ScriptExecutionServiceLive,
				TranslationsRepository.layer,
				RelationshipsServiceLive,
				PluginIngestionServiceLive,
				PluginInstallationRuntimeLive,
				RelationshipSchemaReaderLive,
			),
		),
		Layer.provide(PluginRepository.layer),
		Layer.provide(DefinitionRepository.layer),
	),
	OperationalGateService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				OperationalGateRepository.layer,
				ImportsServiceLive,
				IngestionExecutionLive,
				ImportsRepository.layer,
				ScriptExecutionServiceLive,
				PluginRuntimeResolverLive,
			),
		),
	),
);
