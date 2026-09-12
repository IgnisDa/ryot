import { Layer } from "effect";

import { ProviderHttpAdmissionService } from "#lib/infrastructure/provider-http-admission";
import { LifecycleServicesLive } from "#modules/automations/layer";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { PluginHttpRateLimitAuthority } from "#modules/plugins/http-rate-limit-authority";
import { PluginRepository } from "#modules/plugins/repository";
import { SandboxHostImplementationsLive } from "#modules/sandbox/layer";
import { SandboxRepository } from "#modules/sandbox/repository";

import {
	SandboxDurableHostDispatcherLive,
	SandboxDurableHostServiceWorkflowLive,
} from "./durable-host-dispatcher";

export const SandboxDurableHostServicesLive = Layer.merge(
	SandboxDurableHostDispatcherLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				SandboxHostImplementationsLive,
				PluginHttpRateLimitAuthority.layer.pipe(Layer.provide(PluginRepository.layer)),
				ProviderHttpAdmissionService.layer,
			),
		),
	),
	SandboxDurableHostServiceWorkflowLive.pipe(Layer.provide(SandboxHostImplementationsLive)),
).pipe(
	Layer.provide(SandboxRepository.layer),
	Layer.provide(LifecycleServicesLive),
	Layer.provide(PluginRepository.layer),
	Layer.provide(DefinitionRepository.layer),
);
