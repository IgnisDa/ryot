import { Layer } from "effect";

import { UploadsApi } from "#/api/uploads";
import { ManagedAssetsService } from "#/modules/assets/managed-assets";
import { Uploads } from "#/modules/assets/uploads";

export const AssetsLive = Layer.merge(ManagedAssetsService.layer, Uploads.layer).pipe(
	Layer.provide(UploadsApi.layer),
);
