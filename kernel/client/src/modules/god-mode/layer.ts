import { Layer } from "effect";

import { GodModeApi } from "#/api/god-mode";
import { GodModeService } from "#/modules/god-mode/service";
import { GodModeSessionService } from "#/modules/god-mode/session";

export const GodModeLive = Layer.mergeAll(
	GodModeService.layer.pipe(
		Layer.provide(GodModeApi.layer),
		Layer.provide(GodModeSessionService.layer),
	),
	GodModeSessionService.layer,
);
