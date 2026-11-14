import { Layer } from "effect";

import { PluginsApi } from "#/api/plugins";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { BackgroundSubmissionService } from "#/modules/background-submissions/service";
import { PluginOperationsService } from "#/modules/pages/bridge/operations";

export const BackgroundSubmissionsLive = BackgroundSubmissionService.layer.pipe(
	Layer.provide(PluginOperationsService.layer.pipe(Layer.provide(PluginsApi.layer))),
	Layer.provide(OAuthTokenService.layer),
);
