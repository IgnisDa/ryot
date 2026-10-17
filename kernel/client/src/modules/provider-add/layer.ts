import { Layer } from "effect";

import { EntityProvidersApi } from "#/api/entity-providers";
import { ProviderAddService } from "#/modules/provider-add/service";

export const ProviderAddLive = ProviderAddService.layer.pipe(
	Layer.provide(EntityProvidersApi.layer),
);
