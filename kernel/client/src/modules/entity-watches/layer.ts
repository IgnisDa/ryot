import { Layer } from "effect";

import { EntityWatchApi } from "#/api/entity-watches";
import { EntityWatchService } from "#/modules/entity-watches/service";
import { EntityWatchTransport } from "#/modules/entity-watches/transport";

export const EntityWatchLive = EntityWatchService.layer.pipe(
	Layer.provide(EntityWatchApi.layer),
	Layer.provide(EntityWatchTransport.layer),
);
