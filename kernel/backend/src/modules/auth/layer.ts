import { Layer } from "effect";

import { AuthUserBootstrapSchedulerLive } from "#modules/user-bootstrap/layer";

import { LifecycleWriteGuard } from "./lifecycle-write-guard";
import { InternalOAuthProvisioningComplete, OAuthProvisioningService } from "./oauth-provisioning";
import { AuthRepository } from "./repository";
import { AuthService } from "./service";
import { SessionCreationGate } from "./session-gate";

export const AuthServiceLive = AuthService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			AuthRepository.layer,
			AuthUserBootstrapSchedulerLive,
			SessionCreationGate.layer.pipe(Layer.provideMerge(LifecycleWriteGuard.layer)),
		),
	),
);

export const InternalOAuthProvisioningLive = InternalOAuthProvisioningComplete.layer.pipe(
	Layer.provide(OAuthProvisioningService.layer),
	Layer.provide(AuthRepository.layer),
);
