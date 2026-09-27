import { Effect, Layer } from "effect";

import { makeAutomationSandboxApiFunctions } from "#lib/infrastructure/sandbox-runtime/automation-host-functions";
import {
	makeAdditionalSandboxApiFunctions,
	makeSandboxLifecycleHostApi,
} from "#lib/infrastructure/sandbox-runtime/host-functions";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import { makeRuntimeSandboxApiFunctions } from "#lib/infrastructure/sandbox-runtime/runtime-host-functions";
import { SandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { AuthRepository } from "#modules/auth/repository";
import { LifecycleServicesLive, SignalEmissionServiceLive } from "#modules/automations/layer";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EventsServiceLive, EventStreamWorkServiceLive } from "#modules/events/layer";
import { ImportSourceStateStore } from "#modules/imports/runtime/source-state-store";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { NotificationsServiceLive } from "#modules/notifications/layer";
import { OAuthConnectionsServiceLive } from "#modules/oauth-connections/layer";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { PluginSandboxScriptResolverLive } from "#modules/plugins/sandbox-plugin-script-resolver-live";
import { RelationshipMutationPipelineLive } from "#modules/relationships/layer";
import { RyotQLService } from "#modules/ryotql/service";

import { EventStreamProcessorLive } from "./event-stream-processor";
import { SandboxRepository } from "./repository";
import { SandboxWorkflowPinning } from "./sandbox-script-workflow";
import { SandboxExecutionService } from "./service";
import { SandboxWorkflowReferenceRepository } from "./workflow-reference-repository";

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

export const SandboxExecutionServiceLive = SandboxExecutionService.layer.pipe(
	Layer.provide(Layer.merge(SandboxWorkflowPinningLive, SandboxExecutionRepositoriesLive)),
);

const EventStreamWorkServiceProvidedLive = EventStreamWorkServiceLive.pipe(
	Layer.provide(EventStreamProcessorLive.pipe(Layer.provide(SandboxExecutionServiceLive))),
);

export const SandboxHostImplementationsLive = Layer.effect(
	SandboxHostImplementations,
	Effect.all({
		lifecycle: makeSandboxLifecycleHostApi,
		runtime: makeRuntimeSandboxApiFunctions,
		additional: makeAdditionalSandboxApiFunctions,
		automation: makeAutomationSandboxApiFunctions,
	}),
).pipe(
	Layer.provide(
		Layer.mergeAll(
			EventsServiceLive,
			EventStreamWorkServiceProvidedLive,
			RyotQLService.layer,
			RelationshipMutationPipelineLive,
			SignalEmissionServiceLive,
			NotificationsServiceLive,
			OAuthConnectionsServiceLive,
		),
	),
	Layer.provide(EntitiesServiceRuntimeLive),
	Layer.provide(LifecycleServicesLive),
	Layer.provide(EntitiesRepositoryLive),
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(PluginRepository.layer),
	Layer.provide(ImportSourceStateStore.layer),
	Layer.provide(PluginInstallationRepository.layer),
	Layer.provide(SandboxRepository.layer),
	Layer.provide(DefinitionRepository.layer),
	Layer.provide(IntegrationsRepository.layer),
	Layer.provide(AuthRepository.layer),
);

export const RuntimeSandboxServiceLive = SandboxService.layer.pipe(
	Layer.provide(SandboxHostImplementationsLive),
);
