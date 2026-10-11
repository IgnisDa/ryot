import { Layer } from "effect";

import { LifecycleWriteGuard } from "#modules/accounts/auth/lifecycle-write-guard";

import { ManagedAssetsService } from "./storage/managed-assets";
import { ManagedAssetsRepository } from "./storage/managed-assets-repository";
import { ObjectStorageService } from "./storage/object-storage";
import { UploadIntentsService } from "./uploads/intents";

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
