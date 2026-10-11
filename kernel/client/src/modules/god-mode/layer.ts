import { Layer } from "effect";

import { GodModeApi } from "#/api/god-mode";
import { AuthLive } from "#/modules/auth/layer";
import { GodModeImpersonationService } from "#/modules/god-mode/impersonation";
import { InstanceAdminService } from "#/modules/god-mode/service";
import { GodModeSessionService } from "#/modules/god-mode/session";

const session = GodModeSessionService.layer;
const service = InstanceAdminService.layer.pipe(
	Layer.provide(GodModeApi.layer),
	Layer.provide(session),
);

export const GodModeLive = Layer.mergeAll(
	service,
	session,
	GodModeImpersonationService.layer.pipe(Layer.provideMerge(service), Layer.provideMerge(AuthLive)),
);
