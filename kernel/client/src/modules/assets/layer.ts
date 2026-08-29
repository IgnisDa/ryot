import { Layer } from "effect";

import { UploadsApi } from "#/api/uploads";
import { ManagedAssetsService } from "#/modules/assets/managed-assets";
import { TemporaryUploads } from "#/modules/assets/temporary-uploads";

export const AssetsLive = Layer.merge(ManagedAssetsService.layer, TemporaryUploads.layer).pipe(
	Layer.provide(UploadsApi.layer),
);
