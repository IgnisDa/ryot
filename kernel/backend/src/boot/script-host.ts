import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { Effect, Layer } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { makeAuthScriptHost } from "#modules/accounts/auth/script-host";
import { ManagedAssetsServiceLive } from "#modules/assets/layer";
import { makeAssetsScriptHost } from "#modules/assets/script-host";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { ImportSourceStateStore } from "#modules/imports/runtime/source-state-store";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { makeIntegrationScriptHost } from "#modules/integrations/script-host";
import { OAuthConnectionsServiceLive } from "#modules/oauth-connections/layer";
import { makeOAuthConnectionScriptHost } from "#modules/oauth-connections/script-host";
import { PluginHttpRateLimitAuthority } from "#modules/plugins/catalog/http-rate-limit-authority";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { makePluginScriptHost } from "#modules/plugins/script-host";
import { makeRyotQLScriptHost } from "#modules/ryotql/script-host";
import { RyotQLService } from "#modules/ryotql/service";
import { SandboxExecutionAuthorityLive } from "#modules/scripts/authorization/authority";
import type { AdditionalScriptHostImplementationMap } from "#modules/scripts/authorization/capabilities";
import { makeEntitlementScriptHost } from "#modules/scripts/entitlement-script-host";
import { sandboxHttpRedirectClassifier } from "#modules/scripts/host/durable-dispatcher";
import { SandboxDurableHostDispatcherLive } from "#modules/scripts/host/durable-dispatcher-live";
import { ScriptHostImplementations } from "#modules/scripts/host/host-implementations";
import { ProviderHttpAdmissionService } from "#modules/scripts/host/http-admission";
import { makeRuntimeSandboxApiFunctions } from "#modules/scripts/host/runtime-host-functions";
import {
	SandboxHostCallScopeLive,
	SandboxHostFunctionsLive,
	SandboxStateStoreLive,
} from "#modules/scripts/host/sandbox-host-live";
import { SandboxRepository } from "#modules/scripts/registry/repository";

export const makeAdditionalScriptHostFunctions = Effect.gen(function* () {
	return {
		invokeCapability: () => Effect.fail({ message: "Capability calls require an agent run" }),
		...(yield* makeAuthScriptHost),
		...(yield* makeAssetsScriptHost),
		...(yield* makeIntegrationScriptHost),
		...(yield* makeOAuthConnectionScriptHost),
		...(yield* makePluginScriptHost),
		...(yield* makeRyotQLScriptHost),
		...(yield* makeEntitlementScriptHost),
	} satisfies AdditionalScriptHostImplementationMap;
});

export const ScriptHostImplementationsLive = Layer.effect(
	ScriptHostImplementations,
	Effect.all({
		additional: makeAdditionalScriptHostFunctions,
		runtime: Effect.flatMap(PluginHttpRateLimitAuthority, (authority) =>
			makeRuntimeSandboxApiFunctions(sandboxHttpRedirectClassifier(authority.resolve)),
		),
	}),
).pipe(
	Layer.provide(
		Layer.mergeAll(ManagedAssetsServiceLive, RyotQLService.layer, OAuthConnectionsServiceLive),
	),
	Layer.provide(DefinitionCatalog.layer),
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
	Layer.provide(SandboxStateStoreLive),
	Layer.provide(SandboxExecutionAuthorityLive.pipe(Layer.provide(SandboxRepository.layer))),
);

export const SandboxDurableHostDispatcherProvidedLive = SandboxDurableHostDispatcherLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			ScriptHostImplementationsLive,
			PluginHttpRateLimitAuthority.layer.pipe(Layer.provide(PluginRepository.layer)),
			ProviderHttpAdmissionService.layer,
		),
	),
	Layer.provideMerge(SandboxExecutionAuthorityLive),
	Layer.provide(SandboxRepository.layer),
	Layer.provide(PluginRepository.layer),
	Layer.provide(DefinitionRepository.layer),
);
