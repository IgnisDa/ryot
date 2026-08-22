import { Layer } from "effect";

import { UploadsApi } from "#/api/uploads";
import { ManagedAssetsService } from "#/modules/assets/managed-assets";

export const AssetsLive = ManagedAssetsService.layer.pipe(Layer.provide(UploadsApi.layer));
