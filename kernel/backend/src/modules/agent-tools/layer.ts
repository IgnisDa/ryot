import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { PageAuthoringServiceLive } from "#modules/pages/authoring/layer";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { OperationsServiceLive } from "#modules/plugins/operations/layer";
import { RyotQLService } from "#modules/ryotql/service";
import { SavedViewsServiceLive } from "#modules/saved-views/layer";
import { AgentScriptRepository } from "#modules/scripts/agent/repository";
import { AgentScriptService } from "#modules/scripts/agent/service";
import { SandboxCompiler } from "#modules/scripts/registry/compiler";

import { CapabilityCatalog } from "./catalog";
import { AgentDocs } from "./docs";
import { KernelCapabilities } from "./kernel-capabilities";
import { AgentToolsService } from "./service";

export const AgentToolsServiceLive = AgentToolsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			AuthServiceLive,
			AgentDocs.layer,
			PageAuthoringServiceLive,
			CapabilityCatalog.layer.pipe(
				Layer.provide(
					Layer.mergeAll(
						KernelCapabilities.layer.pipe(
							Layer.provide(
								Layer.mergeAll(
									PageAuthoringServiceLive,
									SavedViewsServiceLive,
									RyotQLService.layer,
									DefinitionCatalog.layer,
									DefinitionRepository.layer,
								),
							),
						),
						DefinitionCatalog.layer,
						PluginRuntimeResolverLive,
						OperationsServiceLive,
						RyotQLService.layer,
					),
				),
			),
			AgentScriptService.layer.pipe(
				Layer.provide(Layer.merge(AgentScriptRepository.layer, SandboxCompiler.layer)),
			),
		),
	),
);
