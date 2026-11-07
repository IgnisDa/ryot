import { Layer } from "effect";

import { LiveUpdatesApi } from "#/api/live-updates";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { EntityWatchService } from "#/modules/entity-watches/service";
import { EntityWatchTransport } from "#/modules/entity-watches/transport";

export const EntityWatchLive = EntityWatchService.layer.pipe(
	Layer.provide(LiveUpdatesApi.layer.pipe(Layer.provide(OAuthTokenService.layer))),
	Layer.provide(EntityWatchTransport.layer),
);
