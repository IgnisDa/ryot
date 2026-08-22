import { Layer } from "effect";

import { AuthServiceLive } from "#modules/auth/layer";
import { UserLifecycleServiceLive } from "#modules/user-lifecycle/layer";

import { GodModeRepository } from "./repository";
import { GodModeService } from "./service";

export const GodModeServiceLive = GodModeService.layer.pipe(
	Layer.provide(Layer.mergeAll(GodModeRepository.layer, UserLifecycleServiceLive, AuthServiceLive)),
);
