import { Layer } from "effect";

import { AuthServiceLive } from "#modules/auth/layer";
import { NotificationSubscriptionsServiceLive } from "#modules/automations/layer";
import { ClientSurfaceMaterializerLive } from "#modules/client-pages/layer";
import { PluginInstallationRuntimeLive } from "#modules/plugins/layer";
import { SavedViewsServiceLive } from "#modules/saved-views/layer";
import { ObjectStorageServiceLive } from "#modules/uploads/layer";
import { PluginUserBootstrapDispatcherLive } from "#modules/user-bootstrap/layer";

import { UserLifecycleRepository } from "./repository";
import { UserLifecycleService } from "./service";
import { UserLifecycleWorkflowOperationsLive } from "./workflow";

export const UserLifecycleServiceLive = UserLifecycleService.layer.pipe(
	Layer.provide(Layer.merge(AuthServiceLive, UserLifecycleRepository.layer)),
);

export const UserLifecycleWorkflowOperationsProvidedLive = UserLifecycleWorkflowOperationsLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			AuthServiceLive,
			SavedViewsServiceLive,
			UserLifecycleRepository.layer,
			ObjectStorageServiceLive,
			PluginUserBootstrapDispatcherLive,
			PluginInstallationRuntimeLive,
			NotificationSubscriptionsServiceLive,
			ClientSurfaceMaterializerLive,
		),
	),
);
