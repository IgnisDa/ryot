import { Layer } from "effect";

import { PublicApi } from "#/api/public";
import { IntegrationsService } from "#/modules/integrations/service";

export const IntegrationsLive = IntegrationsService.layer.pipe(Layer.provide(PublicApi.layer));
