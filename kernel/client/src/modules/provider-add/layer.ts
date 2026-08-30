import { Layer } from "effect";

import { ProviderEntitiesApi } from "#/api/provider-entities";
import { ProviderAddService } from "#/modules/provider-add/service";

export const ProviderAddLive = ProviderAddService.layer.pipe(
	Layer.provide(ProviderEntitiesApi.layer),
);
