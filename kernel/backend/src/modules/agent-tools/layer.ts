import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { OperationsServiceLive } from "#modules/plugins/operations/layer";
import { RyotQLService } from "#modules/ryotql/service";
import { AgentScriptRepository } from "#modules/scripts/agent/repository";
import { AgentScriptService } from "#modules/scripts/agent/service";
import { SandboxCompiler } from "#modules/scripts/registry/compiler";

import { AgentToolsService } from "./service";

export const AgentToolsServiceLive = AgentToolsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			AuthServiceLive,
			AgentScriptService.layer.pipe(
				Layer.provide(Layer.merge(AgentScriptRepository.layer, SandboxCompiler.layer)),
			),
			DefinitionCatalog.layer,
			DefinitionRepository.layer,
			PluginRuntimeResolverLive,
			OperationsServiceLive,
			RyotQLService.layer,
		),
	),
);
