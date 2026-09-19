import { Layer } from "effect";

import { EntityInterestApi } from "#/api/entity-interest";
import { EntityInterestService } from "#/modules/entity-interest/service";
import { EntityInterestTransport } from "#/modules/entity-interest/transport";

export const EntityInterestLive = EntityInterestService.layer.pipe(
	Layer.provide(EntityInterestApi.layer),
	Layer.provide(EntityInterestTransport.layer),
);
