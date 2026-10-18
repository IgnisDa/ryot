import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { Effect, Layer } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { makeAuthScriptHost } from "#modules/accounts/auth/script-host";
import { ManagedAssetsServiceLive } from "#modules/assets/layer";
import { makeAssetsScriptHost } from "#modules/assets/script-host";
import { LifecycleServicesLive, SignalEmissionServiceLive } from "#modules/automations/layer";
import { makeSignalScriptHost } from "#modules/automations/script-host";
import { BackgroundWorkService } from "#modules/background-work/service";
import { DefinitionRepository } from "#modules/definitions/repository";
import { makeDefinitionScriptHost } from "#modules/definitions/script-host";
import { EntitiesServiceRuntimeLive } from "#modules/entities/layer";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { entityLifecycleHostSteps, makeEntityScriptHost } from "#modules/entities/script-host";
import { EntitiesService } from "#modules/entities/service";
import { EntityUserDataServiceLive } from "#modules/entities/user-data/layer";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
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
import { PluginCatalogInvalidatorLive } from "#modules/plugins/catalog/events";
import { PluginHttpRateLimitAuthority } from "#modules/plugins/catalog/http-rate-limit-authority";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { PluginUserSettingsWriter } from "#modules/plugins/preferences/user-settings-writer";
import { makePluginScriptHost } from "#modules/plugins/script-host";
import {
	RelationshipMutationPipelineLive,
	RelationshipProjectionServiceLive,
} from "#modules/relationships/layer";
import { RelationshipMutationPipeline } from "#modules/relationships/mutation-pipeline";
import {
	makeRelationshipScriptHost,
	relationshipLifecycleHostSteps,
} from "#modules/relationships/script-host";
import { makeRyotQLScriptHost } from "#modules/ryotql/script-host";
import { RyotQLService } from "#modules/ryotql/service";
import { SandboxExecutionAuthorityLive } from "#modules/scripts/authorization/authority";
import type { AdditionalScriptHostImplementationMap } from "#modules/scripts/authorization/capabilities";
import { ProjectionBindingsLive } from "#modules/scripts/executions/projection-bindings";
import { makeUserWorkScriptHost } from "#modules/scripts/executions/user-work";
import { sandboxHttpRedirectClassifier } from "#modules/scripts/host/durable-dispatcher";
import {
	SandboxDurableHostDispatcherLive,
	SandboxDurableHostServiceWorkflowLive,
} from "#modules/scripts/host/durable-dispatcher-live";
import { ScriptHostImplementations } from "#modules/scripts/host/host-implementations";
import { ProviderHttpAdmissionService } from "#modules/scripts/host/http-admission";
import { makeRuntimeSandboxApiFunctions } from "#modules/scripts/host/runtime-host-functions";
import {
	SandboxHostCallScopeLive,
	SandboxHostFunctionsLive,
	SandboxRedisLive,
} from "#modules/scripts/host/sandbox-host-live";
import { SandboxSubmissionCommands } from "#modules/scripts/host/submission-command";
import { makeProKeyScriptHost } from "#modules/scripts/pro-key-script-host";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { makeUserCommandScriptHost } from "#modules/user-commands/script-host";
import { UserCommands } from "#modules/user-commands/service";

export const makeAdditionalScriptHostFunctions = Effect.gen(function* () {
	return {
		...(yield* makeAuthScriptHost),
		...(yield* makeAssetsScriptHost),
		...(yield* makeDefinitionScriptHost),
		...(yield* makeEntityScriptHost),
		...(yield* makeEventScriptHost),
		...(yield* makeIntegrationScriptHost),
		...(yield* makeOAuthConnectionScriptHost),
		...(yield* makePluginScriptHost),
		...(yield* makeRelationshipScriptHost),
		...(yield* makeRyotQLScriptHost),
		...(yield* makeProKeyScriptHost),
		...(yield* makeUserCommandScriptHost),
		...(yield* makeUserWorkScriptHost),
	} satisfies AdditionalScriptHostImplementationMap;
});

const makeScriptLifecycleHostSteps = Effect.gen(function* () {
	return {
		...eventLifecycleHostSteps(yield* EventsService, yield* SandboxSubmissionCommands),
		...entityLifecycleHostSteps(yield* EntitiesService),
		...relationshipLifecycleHostSteps(
			yield* RelationshipMutationPipeline,
			yield* SandboxSubmissionCommands,
		),
	};
});

export const makeAutomationScriptHostFunctions = Effect.gen(function* () {
	return { ...(yield* makeSignalScriptHost), ...(yield* makeNotificationScriptHost) };
});

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
			DomainWriteChecksLive,
			BackgroundWorkService.layer,
			EventsServiceLive,
			ManagedAssetsServiceLive,
			EventStreamWorkServiceLive.pipe(Layer.provide(ProjectionBindingsLive)),
			RelationshipProjectionServiceLive.pipe(Layer.provide(ProjectionBindingsLive)),
			RyotQLService.layer,
			RelationshipMutationPipelineLive,
			EntityUserDataServiceLive,
			SignalEmissionServiceLive,
			NotificationsServiceLive,
			OAuthConnectionsServiceLive,
			UserCommands.layer,
		),
	),
	Layer.provide(EntitiesServiceRuntimeLive),
	Layer.provide(LifecycleServicesLive),
	Layer.provide(EntitiesRepositoryLive),
	Layer.provide(SandboxSubmissionCommands.layer),
	Layer.provide(PluginUserSettingsWriter.layer),
	Layer.provide(PluginCatalogInvalidatorLive),
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

export const SandboxDurableHostServicesLive = Layer.mergeAll(
	SandboxDurableHostDispatcherLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				ScriptHostImplementationsLive,
				SandboxSubmissionCommands.layer,
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
