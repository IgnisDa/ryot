import { Effect, Layer } from "effect";

import { IosLiveActivityPlatform } from "#/modules/ios-live-activities/service";

export const unsupportedIosLiveActivityPlatform = Layer.succeed(IosLiveActivityPlatform, {
	retainOwners: () => Effect.void,
	request: () => Effect.succeed({ status: "unsupported" }),
});
