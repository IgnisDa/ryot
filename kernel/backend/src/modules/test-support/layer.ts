import { Layer } from "effect";

import { AuthServiceLive } from "#modules/auth/layer";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { InterestServicesLive } from "#modules/entity-interest/layer";
import { TranslationsServiceLive } from "#modules/entity-translation/layer";
import { ImportsServiceLive, IngestionExecutionLive } from "#modules/imports/layer";
import { ImportsRepository } from "#modules/imports/repository";
import { PluginIngestionServiceLive, PluginInstallationRuntimeLive } from "#modules/plugins/layer";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { RelationshipSchemasRepositoryLive } from "#modules/relationship-schemas/layer";
import { RelationshipsServiceLive } from "#modules/relationships/layer";
import { SandboxExecutionServiceLive } from "#modules/sandbox/layer";
import { PluginCronServiceLive } from "#modules/scheduler/layer";

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
				SandboxExecutionServiceLive,
				TranslationsServiceLive,
				RelationshipsServiceLive,
				PluginIngestionServiceLive,
				PluginInstallationRuntimeLive,
				RelationshipSchemasRepositoryLive,
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
				SandboxExecutionServiceLive,
				PluginRuntimeResolverLive,
			),
		),
	),
);
