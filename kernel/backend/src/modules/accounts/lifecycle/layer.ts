import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { UserBootstrapLive } from "#modules/accounts/provisioning/layer";
import { ObjectStorageServiceLive } from "#modules/assets/layer";
import { IngestionExecutionLive } from "#modules/imports/layer";

import { UserLifecycleJobLive, UserLifecycleJobOperationsLive } from "./job";
import { UserLifecycleRepository } from "./repository";
import { UserLifecycleService } from "./service";

export const UserLifecycleServiceLive = UserLifecycleService.layer.pipe(
	Layer.provide(Layer.merge(AuthServiceLive, UserLifecycleRepository.layer)),
);

const UserLifecycleJobOperationsProvidedLive = UserLifecycleJobOperationsLive.pipe(
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

export const UserLifecycleJobProvidedLive = UserLifecycleJobLive.pipe(
	Layer.provide(Layer.merge(UserLifecycleJobOperationsProvidedLive, UserLifecycleServiceLive)),
);
