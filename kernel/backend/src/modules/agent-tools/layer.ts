import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { OperationsServiceLive } from "#modules/plugins/operations/layer";
import { RyotQLService } from "#modules/ryotql/service";

import { AgentToolsService } from "./service";

export const AgentToolsServiceLive = AgentToolsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			AuthServiceLive,
			DefinitionCatalog.layer,
			DefinitionRepository.layer,
			PluginRuntimeResolverLive,
			OperationsServiceLive,
			RyotQLService.layer,
		),
	),
);
