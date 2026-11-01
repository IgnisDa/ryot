import { Layer } from "effect";

import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { PluginSandboxScriptResolverLive } from "#modules/plugins/catalog/script-resolver-live";

import { ScriptExecutionService } from "./executions/service";
import { SandboxWorkflowPinning } from "./executions/workflow";
import { SandboxRepository } from "./registry/repository";
import { SandboxWorkflowReferenceRepository } from "./registry/workflow-references";

export const SandboxPluginScriptResolverLive = Layer.provideMerge(
	PluginSandboxScriptResolverLive,
	PluginRuntimeResolverLive,
);

const SandboxExecutionRepositoriesLive = Layer.mergeAll(
	SandboxRepository.layer,
	SandboxWorkflowReferenceRepository.layer,
	SandboxPluginScriptResolverLive,
);

export const SandboxWorkflowPinningLive = SandboxWorkflowPinning.layer.pipe(
	Layer.provide(SandboxExecutionRepositoriesLive),
);

export const ScriptExecutionServiceLive = ScriptExecutionService.layer.pipe(
	Layer.provide(Layer.merge(SandboxWorkflowPinningLive, SandboxExecutionRepositoriesLive)),
);
