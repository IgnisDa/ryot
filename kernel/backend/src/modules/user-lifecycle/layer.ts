import { Layer } from "effect";

import { AuthServiceLive } from "#modules/auth/layer";
import { IngestionExecutionLive } from "#modules/imports/layer";
import { ObjectStorageServiceLive } from "#modules/uploads/layer";
import { UserBootstrapLive } from "#modules/user-bootstrap/layer";

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
