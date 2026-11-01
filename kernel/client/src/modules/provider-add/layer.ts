import { Layer } from "effect";

import { EntitiesApi } from "#/api/entities";
import { EntityProvidersApi } from "#/api/entity-providers";
import { ProviderAddService } from "#/modules/provider-add/service";

export const ProviderAddLive = ProviderAddService.layer.pipe(
	Layer.provide(Layer.mergeAll(EntityProvidersApi.layer, EntitiesApi.layer)),
);
