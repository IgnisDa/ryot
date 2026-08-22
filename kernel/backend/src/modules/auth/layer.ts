import { Layer } from "effect";

import { AuthUserBootstrapServiceLive } from "#modules/user-bootstrap/layer";

import { InternalOAuthProvisioningComplete, OAuthProvisioningService } from "./oauth-provisioning";
import { AuthRepository } from "./repository";
import { AuthService } from "./service";

export const AuthServiceLive = AuthService.layer.pipe(
	Layer.provide(Layer.merge(AuthRepository.layer, AuthUserBootstrapServiceLive)),
);

export const InternalOAuthProvisioningLive = InternalOAuthProvisioningComplete.layer.pipe(
	Layer.provide(OAuthProvisioningService.layer),
	Layer.provide(AuthRepository.layer),
);
