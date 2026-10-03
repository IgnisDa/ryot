import { Layer } from "effect";

import { AuthServiceLive } from "#modules/auth/layer";
import { UserLifecycleServiceLive } from "#modules/user-lifecycle/layer";

import { ServerLogs } from "./logs";
import { GodModeRepository } from "./repository";
import { GodModeService } from "./service";

export const GodModeServiceLive = Layer.mergeAll(
	ServerLogs.layer,
	GodModeService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(GodModeRepository.layer, UserLifecycleServiceLive, AuthServiceLive),
		),
	),
);
