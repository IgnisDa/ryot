import { Layer } from "effect";

import { DevicePlatformLive } from "#/modules/device/platform";
import { DeviceService } from "#/modules/device/service";
import { ClientStorage } from "#/persistence/storage";

export const DeviceLive = DeviceService.layer.pipe(
	Layer.provide(DevicePlatformLive),
	Layer.provide(ClientStorage.layer),
);
