import { Effect } from "effect";

import type { DevicePlatform } from "#/modules/device/service";

export const noopDevicePlatform: DevicePlatform["Service"] = {
	awake: () => Effect.void,
	cancel: () => Effect.void,
	haptic: () => Effect.void,
	listen: () => Effect.succeed(() => {}),
	schedule: () => Effect.succeed({ status: "unsupported" }),
};
