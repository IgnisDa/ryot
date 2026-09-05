import { Layer } from "effect";

import { NotificationSubscriptionsServiceLive } from "#modules/automations/layer";
import { ClientSurfaceMaterializerLive } from "#modules/client-pages/layer";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginInstallationRuntimeLive } from "#modules/plugins/layer";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionServiceLive } from "#modules/sandbox/layer";

import { AuthUserBootstrapLive, UserBootstrap } from "./bootstrap";
import { PluginUserBootstrapDispatcher } from "./plugin-dispatch";

export const PluginUserBootstrapDispatcherLive = PluginUserBootstrapDispatcher.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			SandboxExecutionServiceLive,
			PluginRuntimeResolverLive,
			PluginInstallationRepository.layer,
		),
	),
);

export const UserBootstrapLive = UserBootstrap.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ClientSurfaceMaterializerLive,
			NotificationSubscriptionsServiceLive,
			PluginUserBootstrapDispatcherLive,
			PluginInstallationRuntimeLive,
		),
	),
);

export const AuthUserBootstrapServiceLive = AuthUserBootstrapLive.pipe(
	Layer.provide(UserBootstrapLive),
);
