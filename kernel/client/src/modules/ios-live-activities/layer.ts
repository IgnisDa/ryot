import { Layer } from "effect";

import { IosLiveActivityPlatformLive } from "#/modules/ios-live-activities/platform";
import { IosLiveActivitiesService } from "#/modules/ios-live-activities/service";

export const IosLiveActivitiesLive = IosLiveActivitiesService.layer.pipe(
	Layer.provide(IosLiveActivityPlatformLive),
);
