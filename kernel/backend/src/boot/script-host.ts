import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import type { AdditionalSandboxHostImplementationMap } from "@ryot-app/sandbox/host/invocation";
import { Effect, Layer } from "effect";

import { ProviderHttpAdmissionService } from "#lib/infrastructure/provider-http-admission";
import { AuthRepository } from "#modules/auth/repository";
import { makeAuthScriptHost } from "#modules/auth/script-host";
import { LifecycleServicesLive, SignalEmissionServiceLive } from "#modules/automations/layer";
import { makeSignalScriptHost } from "#modules/automations/script-host";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { makeDefinitionScriptHost } from "#modules/definition-registry/script-host";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { entityLifecycleHostSteps, makeEntityScriptHost } from "#modules/entities/script-host";
import { EntitiesService } from "#modules/entities/service";
import { EventsServiceLive, EventStreamWorkServiceLive } from "#modules/events/layer";
import { eventLifecycleHostSteps, makeEventScriptHost } from "#modules/events/script-host";
import { EventsService } from "#modules/events/service";
import { ImportSourceStateStore } from "#modules/imports/runtime/source-state-store";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { makeIntegrationScriptHost } from "#modules/integrations/script-host";
import { NotificationsServiceLive } from "#modules/notifications/layer";
import { makeNotificationScriptHost } from "#modules/notifications/script-host";
import { OAuthConnectionsServiceLive } from "#modules/oauth-connections/layer";
import { makeOAuthConnectionScriptHost } from "#modules/oauth-connections/script-host";
import { PluginHttpRateLimitAuthority } from "#modules/plugins/http-rate-limit-authority";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { makePluginScriptHost } from "#modules/plugins/script-host";
import { RelationshipMutationPipelineLive } from "#modules/relationships/layer";
import { RelationshipMutationPipeline } from "#modules/relationships/mutation-pipeline";
import {
	makeRelationshipScriptHost,
	relationshipLifecycleHostSteps,
} from "#modules/relationships/script-host";
import { makeRyotQLScriptHost } from "#modules/ryotql/script-host";
import { RyotQLService } from "#modules/ryotql/service";
import { SandboxExecutionAuthorityLive } from "#modules/scripts/authorization/authority";
import { EventStreamProcessorLive } from "#modules/scripts/executions/event-stream-processor";
import { sandboxHttpRedirectClassifier } from "#modules/scripts/host/durable-dispatcher";
import {
	SandboxDurableHostDispatcherLive,
	SandboxDurableHostServiceWorkflowLive,
} from "#modules/scripts/host/durable-dispatcher-live";
import { ScriptHostImplementations } from "#modules/scripts/host/host-implementations";
import { makeRuntimeSandboxApiFunctions } from "#modules/scripts/host/runtime-host-functions";
import {
	SandboxHostCallScopeLive,
	SandboxHostFunctionsLive,
	SandboxRedisLive,
} from "#modules/scripts/host/sandbox-host-live";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";
import { SandboxRepository } from "#modules/scripts/registry/repository";

export const makeAdditionalScriptHostFunctions = Effect.gen(function* () {
	return {
		...(yield* makeAuthScriptHost),
		...(yield* makeDefinitionScriptHost),
		...(yield* makeEntityScriptHost),
		...(yield* makeEventScriptHost),
		...(yield* makeIntegrationScriptHost),
		...(yield* makeOAuthConnectionScriptHost),
		...(yield* makePluginScriptHost),
		...(yield* makeRelationshipScriptHost),
		...(yield* makeRyotQLScriptHost),
	} satisfies AdditionalSandboxHostImplementationMap;
});

const makeScriptLifecycleHostSteps = Effect.gen(function* () {
	return {
		...eventLifecycleHostSteps(yield* EventsService),
		...entityLifecycleHostSteps(yield* EntitiesService),
		...relationshipLifecycleHostSteps(yield* RelationshipMutationPipeline),
	};
});

export const makeAutomationScriptHostFunctions = Effect.gen(function* () {
	return { ...(yield* makeSignalScriptHost), ...(yield* makeNotificationScriptHost) };
});

const EventStreamWorkServiceProvidedLive = EventStreamWorkServiceLive.pipe(
	Layer.provide(EventStreamProcessorLive.pipe(Layer.provide(ScriptExecutionServiceLive))),
);

export const ScriptHostImplementationsLive = Layer.effect(
	ScriptHostImplementations,
	Effect.all({
		lifecycle: makeScriptLifecycleHostSteps,
		additional: makeAdditionalScriptHostFunctions,
		automation: makeAutomationScriptHostFunctions,
		runtime: Effect.flatMap(PluginHttpRateLimitAuthority, (authority) =>
			makeRuntimeSandboxApiFunctions(sandboxHttpRedirectClassifier(authority.resolve)),
		),
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
	Layer.provide(PluginHttpRateLimitAuthority.layer),
	Layer.provide(PluginRepository.layer),
	Layer.provide(ImportSourceStateStore.layer),
	Layer.provide(PluginInstallationRepository.layer),
	Layer.provide(SandboxRepository.layer),
	Layer.provide(DefinitionRepository.layer),
	Layer.provide(IntegrationsRepository.layer),
	Layer.provide(AuthRepository.layer),
);

export const RuntimeSandboxExecutorLive = SandboxExecutor.layer.pipe(
	Layer.provide(SandboxHostFunctionsLive.pipe(Layer.provide(ScriptHostImplementationsLive))),
	Layer.provide(SandboxHostCallScopeLive),
	Layer.provide(SandboxRedisLive),
	Layer.provide(SandboxExecutionAuthorityLive.pipe(Layer.provide(SandboxRepository.layer))),
);

export const SandboxDurableHostServicesLive = Layer.merge(
	SandboxDurableHostDispatcherLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				ScriptHostImplementationsLive,
				PluginHttpRateLimitAuthority.layer.pipe(Layer.provide(PluginRepository.layer)),
				ProviderHttpAdmissionService.layer,
			),
		),
	),
	SandboxDurableHostServiceWorkflowLive.pipe(Layer.provide(ScriptHostImplementationsLive)),
).pipe(
	Layer.provide(SandboxExecutionAuthorityLive),
	Layer.provide(SandboxRepository.layer),
	Layer.provide(LifecycleServicesLive),
	Layer.provide(PluginRepository.layer),
	Layer.provide(DefinitionRepository.layer),
);
