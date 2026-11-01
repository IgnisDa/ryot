import { unknownToMessage } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import {
	AuthBootstrapScheduleError,
	AuthUserBootstrapScheduler,
} from "#modules/accounts/auth/service";
import { NotificationSubscriptionsServiceLive } from "#modules/automations/layer";
import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginInstallationRuntimeLive } from "#modules/plugins/layer";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";

import { UserBootstrap } from "./bootstrap";
import { PluginUserBootstrapDispatcher } from "./plugin-dispatch";
import { UserBootstrapScheduling } from "./scheduling";

export const PluginUserBootstrapDispatcherLive = PluginUserBootstrapDispatcher.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ScriptExecutionServiceLive,
			PluginRuntimeResolverLive,
			PluginInstallationRepository.layer,
		),
	),
);

export const UserBootstrapLive = UserBootstrap.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			NotificationSubscriptionsServiceLive,
			PluginUserBootstrapDispatcherLive,
			PluginInstallationRuntimeLive,
			AuthRepository.layer,
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
