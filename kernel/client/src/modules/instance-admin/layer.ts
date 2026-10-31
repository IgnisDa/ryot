import { Layer } from "effect";

import { InstanceAdminApi } from "#/api/instance-admin";
import { AuthLive } from "#/modules/auth/layer";
import { InstanceAdminImpersonationService } from "#/modules/instance-admin/impersonation";
import { InstanceAdminService } from "#/modules/instance-admin/service";
import { InstanceAdminSessionService } from "#/modules/instance-admin/session";

const session = InstanceAdminSessionService.layer;
const service = InstanceAdminService.layer.pipe(
	Layer.provide(InstanceAdminApi.layer),
	Layer.provide(session),
);

export const InstanceAdminLive = Layer.mergeAll(
	service,
	session,
	InstanceAdminImpersonationService.layer.pipe(
		Layer.provideMerge(service),
		Layer.provideMerge(AuthLive),
	),
);
