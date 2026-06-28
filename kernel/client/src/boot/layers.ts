import { Layer } from "effect";

import { AdminApi } from "#/api/admin";
import { AuthenticatedApi } from "#/api/authenticated";
import { BackupsApi } from "#/api/backups";
import { ClientPagesApi } from "#/api/client-pages";
import { CollectionsApi } from "#/api/collections";
import { EntityInterestApi } from "#/api/entity-interest";
import { GodModeApi } from "#/api/god-mode";
import { ImportsApi } from "#/api/imports";
import { IntegrationsApi } from "#/api/integrations";
import { NotificationsApi } from "#/api/notifications";
import { PluginInstallationsApi } from "#/api/plugin-installations";
import { PluginsApi } from "#/api/plugins";
import { ProviderEntitiesApi } from "#/api/provider-entities";
import { PublicApi } from "#/api/public";
import { RyotQLApi } from "#/api/ryotql";
import { SavedViewsApi } from "#/api/saved-views";
import { UploadsApi } from "#/api/uploads";
import { UserSettingsApi } from "#/api/user-settings";
import { ManagedAssetsService } from "#/modules/assets/managed-assets";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { OAuthLauncher } from "#/modules/auth/oauth-launcher";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { ClientPageSessions } from "#/modules/client-pages/sessions";
import { EntitiesService } from "#/modules/entities/service";
import { EntityInterestService } from "#/modules/entity-interest/service";
import { EntityInterestTransport } from "#/modules/entity-interest/transport";
import { GodModeService } from "#/modules/god-mode/service";
import { GodModeSessionService } from "#/modules/god-mode/session";
import { ImportsService } from "#/modules/imports/service";
import { IntegrationsService } from "#/modules/integrations/service";
import { CustomizeSidebarService } from "#/modules/navigation/customize/service";
import { NavigationService } from "#/modules/navigation/service";
import { NotificationChannelsService } from "#/modules/notifications/service";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { PluginCatalogEventsService } from "#/modules/plugins/events";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ProviderAddService } from "#/modules/provider-add/service";
import { SavedViewsService } from "#/modules/saved-views/service";
import { ServerService } from "#/modules/server/service";
import { ClientStorage } from "#/persistence/storage";

const OAuthTokenLive = OAuthTokenService.layer.pipe(Layer.provideMerge(OAuthStorage.layer));
const TransportLive = Layer.mergeAll(AdminApi.layer, AuthenticatedApi.layer).pipe(
	Layer.provide(OAuthTokenLive),
	Layer.provide(RuntimeOAuthClientService.layer),
);

const InfrastructureLive = Layer.mergeAll(
	PublicApi.layer,
	EntityInterestApi.layer,
	RyotQLApi.layer,
	BackupsApi.layer,
	ClientPagesApi.layer,
	CollectionsApi.layer,
	UploadsApi.layer,
	PluginsApi.layer,
	ImportsApi.layer,
	GodModeApi.layer,
	SavedViewsApi.layer,
	UserSettingsApi.layer,
	IntegrationsApi.layer,
	NotificationsApi.layer,
	ProviderEntitiesApi.layer,
	PluginInstallationsApi.layer,
).pipe(Layer.provide(TransportLive));

const ServerLive = ServerService.layer.pipe(
	Layer.provideMerge(ClientStorage.layer),
	Layer.provideMerge(InfrastructureLive),
);
const AuthLive = AuthService.layer.pipe(
	Layer.provideMerge(ClientStorage.layer),
	Layer.provideMerge(OAuthTokenLive),
	Layer.provideMerge(RuntimeOAuthClientService.layer),
);
const OAuthLauncherLive = OAuthLauncher.layer.pipe(
	Layer.provideMerge(OAuthStorage.layer),
	Layer.provideMerge(AuthLive),
	Layer.provideMerge(ServerLive),
	Layer.provideMerge(InfrastructureLive),
	Layer.provideMerge(RuntimeOAuthClientService.layer),
);
const GodModeLive = GodModeService.layer.pipe(
	Layer.provideMerge(GodModeSessionService.layer),
	Layer.provideMerge(InfrastructureLive),
);

export const ClientLive = Layer.mergeAll(
	AuthLive,
	EntityInterestService.layer.pipe(Layer.provide(EntityInterestTransport.layer)),
	OAuthLauncherLive,
	HostedAuthService.layer,
	GodModeLive,
	EntitiesService.layer,
	ManagedAssetsService.layer,
	ServerLive,
	ClientPageSessions.layer,
	NavigationService.layer,
	CustomizeSidebarService.layer,
	PluginCatalogService.layer,
	PluginCatalogEventsService.layer.pipe(
		Layer.provideMerge(OAuthTokenLive),
		Layer.provideMerge(RuntimeOAuthClientService.layer),
	),
	PluginOperationsService.layer,
	PluginQueriesService.layer,
	SavedViewsService.layer,
	ProviderAddService.layer,
	ImportsService.layer,
	IntegrationsService.layer,
	NotificationChannelsService.layer,
	OAuthTokenLive,
	RuntimeOAuthClientService.layer,
).pipe(Layer.provideMerge(InfrastructureLive));
