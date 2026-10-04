import { Layer } from "effect";

import { AuthServiceLive } from "#modules/accounts/auth/layer";
import { UserLifecycleServiceLive } from "#modules/accounts/lifecycle/layer";

import { ServerLogs } from "./logs";
import { InstanceAdminRepository } from "./repository";
import { InstanceAdminService } from "./service";

export const InstanceAdminServiceLive = Layer.mergeAll(
	ServerLogs.layer,
	InstanceAdminService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(InstanceAdminRepository.layer, UserLifecycleServiceLive, AuthServiceLive),
		),
	),
);
