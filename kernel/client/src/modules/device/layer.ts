import { Layer } from "effect";

import { DevicePlatformLive } from "#/modules/device/platform";
import { DeviceService } from "#/modules/device/service";

export const DeviceLive = DeviceService.layer.pipe(Layer.provide(DevicePlatformLive));
