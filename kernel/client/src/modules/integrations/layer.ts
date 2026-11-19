import { Layer } from "effect";

import { PublicApi } from "#/api/public";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { OAuthConnectPlatform, OAuthConnectService } from "#/modules/integrations/oauth-connect";
import { OAuthReturnCapture } from "#/modules/integrations/oauth-return";
import { IntegrationsService } from "#/modules/integrations/service";

export const IntegrationsLive = Layer.mergeAll(
	IntegrationsService.layer.pipe(Layer.provide(PublicApi.layer)),
	OAuthConnectService.layer.pipe(
		Layer.provide(OAuthConnectPlatform.layer),
		Layer.provide(RuntimeOAuthClientService.layer),
	),
	OAuthReturnCapture.layer,
);
