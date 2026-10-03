import { Layer } from "effect";

import { ClientPagesApi } from "#/api/client-pages";
import { ClientPageFreshness } from "#/modules/client-pages/freshness";

export const ClientPagesLive = ClientPageFreshness.layer.pipe(Layer.provide(ClientPagesApi.layer));
