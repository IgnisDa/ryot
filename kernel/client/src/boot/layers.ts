import { Layer } from "effect";

import { ApiLive, TransportLive } from "#/api/layer";
import { AssetsLive } from "#/modules/assets/layer";
import { AuthLive } from "#/modules/auth/layer";
import { EntitiesService } from "#/modules/entities/service";
import { EntityInterestLive } from "#/modules/entity-interest/layer";
import { ExternalLinksLive } from "#/modules/external-links/layer";
import { GodModeLive } from "#/modules/god-mode/layer";
import { ImportsService } from "#/modules/imports/service";
import { IntegrationsLive } from "#/modules/integrations/layer";
import { DeepLinkClaims } from "#/modules/navigation/deep-link";
import { NavigationLive } from "#/modules/navigation/layer";
import { NotificationChannelsService } from "#/modules/notifications/service";
import { PagesLive } from "#/modules/pages/layer";
import { PluginsLive } from "#/modules/plugins/layer";
import { ProviderAddLive } from "#/modules/provider-add/layer";
import { SavedViewsService } from "#/modules/saved-views/service";
import { ServerLive } from "#/modules/server/layer";

export const ClientLive = Layer.mergeAll(
	AssetsLive,
	EntitiesService.layer,
	EntityInterestLive,
	ExternalLinksLive,
	GodModeLive,
	ImportsService.layer,
	IntegrationsLive.pipe(Layer.provideMerge(DeepLinkClaims.layer)),
	NavigationLive,
	NotificationChannelsService.layer,
	PagesLive,
	PluginsLive.pipe(Layer.provideMerge(AuthLive)),
	ProviderAddLive,
	SavedViewsService.layer,
	ServerLive,
).pipe(Layer.provideMerge(ApiLive), Layer.provide(TransportLive));
