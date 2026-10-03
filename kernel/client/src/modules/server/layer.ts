import { Layer } from "effect";

import { PublicApi } from "#/api/public";
import { ServerService } from "#/modules/server/service";
import { ClientStorage } from "#/persistence/storage";

export const ServerLive = ServerService.layer.pipe(
	Layer.provideMerge(PublicApi.layer),
	Layer.provideMerge(ClientStorage.layer),
);
