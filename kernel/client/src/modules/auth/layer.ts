import { Layer } from "effect";

import { PublicApi } from "#/api/public";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { OAuthLauncher } from "#/modules/auth/oauth-launcher";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { ServerLive } from "#/modules/server/layer";
import { ClientStorage } from "#/persistence/storage";

const auth = AuthService.layer.pipe(
	Layer.provideMerge(ClientStorage.layer),
	Layer.provideMerge(OAuthTokenService.layer),
	Layer.provideMerge(RuntimeOAuthClientService.layer),
);

export const AuthLive = Layer.mergeAll(
	auth,
	HostedAuthService.layer,
	OAuthLauncher.layer.pipe(
		Layer.provideMerge(auth),
		Layer.provideMerge(OAuthStorage.layer),
		Layer.provideMerge(ServerLive),
		Layer.provide(PublicApi.layer),
	),
);
