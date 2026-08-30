import { Layer } from "effect";

import { LifecycleWriteGuard } from "#modules/auth/lifecycle-write-guard";

import { UploadIntentsService } from "./intents/service";
import { ManagedAssetsRepository } from "./managed-assets/repository";
import { ManagedAssetsService } from "./managed-assets/service";
import { ObjectStorageService } from "./object-storage/service";

export const ObjectStorageServiceLive = ObjectStorageService.layer;

export const ManagedAssetsServiceLive = ManagedAssetsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ManagedAssetsRepository.layer,
			ObjectStorageServiceLive,
			LifecycleWriteGuard.layer,
		),
	),
);

export const UploadServicesLive = Layer.merge(
	ManagedAssetsServiceLive,
	UploadIntentsService.layer.pipe(
		Layer.provide(Layer.merge(ManagedAssetsServiceLive, ObjectStorageServiceLive)),
	),
);
