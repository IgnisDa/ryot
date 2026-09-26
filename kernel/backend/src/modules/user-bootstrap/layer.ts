import { unknownToMessage } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { AuthBootstrapScheduleError, AuthUserBootstrapScheduler } from "#modules/auth/service";
import { NotificationSubscriptionsServiceLive } from "#modules/automations/layer";
import { ClientSurfaceMaterializerLive } from "#modules/client-pages/layer";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginInstallationRuntimeLive } from "#modules/plugins/layer";
import { PluginRuntimeResolverLive } from "#modules/plugins/runtime-resolver";
import { SandboxExecutionServiceLive } from "#modules/sandbox/layer";

import { UserBootstrap } from "./bootstrap";
import { PluginUserBootstrapDispatcher } from "./plugin-dispatch";
import { UserBootstrapScheduling } from "./scheduling";

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

export const UserBootstrapSchedulingLive = UserBootstrapScheduling.layer.pipe(
	Layer.provide(UserBootstrapLive),
);

export const AuthUserBootstrapSchedulerLive = Layer.effect(
	AuthUserBootstrapScheduler,
	Effect.gen(function* () {
		const scheduling = yield* UserBootstrapScheduling;
		return {
			schedule: (userId: string) =>
				scheduling
					.schedule(UserId.make(userId))
					.pipe(
						Effect.mapError(
							(error) => new AuthBootstrapScheduleError({ message: unknownToMessage(error) }),
						),
					),
		};
	}),
).pipe(Layer.provide(UserBootstrapSchedulingLive));
