import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { UserBootstrapLive } from "#modules/accounts/provisioning/layer";
import { ObjectStorageServiceLive } from "#modules/assets/layer";
import { IngestionExecutionLive } from "#modules/imports/layer";

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
			UserLifecycleRepository.layer,
			ObjectStorageServiceLive,
			UserBootstrapLive,
			IngestionExecutionLive,
		),
	),
);
