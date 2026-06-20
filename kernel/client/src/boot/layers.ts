import { Layer } from "effect";

import { AdminApi } from "#/api/admin";
import { AuthenticatedApi } from "#/api/authenticated";
import { PublicApi } from "#/api/public";
import { ManagedAssetsService } from "#/modules/assets/managed-assets";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { OAuthLauncher } from "#/modules/auth/oauth-launcher";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { GodModeService } from "#/modules/god-mode/service";
import { GodModeSessionService } from "#/modules/god-mode/session";
import { CustomizeSidebarService } from "#/modules/navigation/customize/service";
import { NavigationService } from "#/modules/navigation/service";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { PluginCatalogEventsService } from "#/modules/plugins/events";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ProviderAddService } from "#/modules/provider-add/service";
import { SavedViewsService } from "#/modules/saved-views/service";
import { ServerService } from "#/modules/server/service";
import { ClientStorage } from "#/persistence/storage";

const OAuthTokenLive = OAuthTokenService.layer.pipe(Layer.provideMerge(OAuthStorage.layer));
const InfrastructureLive = Layer.mergeAll(
	AdminApi.layer,
	PublicApi.layer,
	AuthenticatedApi.layer,
).pipe(Layer.provideMerge(OAuthTokenLive), Layer.provideMerge(RuntimeOAuthClientService.layer));

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
	OAuthLauncherLive,
	HostedAuthService.layer,
	GodModeLive,
	ManagedAssetsService.layer,
	ServerLive,
	ArtifactSessions.layer,
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
	OAuthTokenLive,
	RuntimeOAuthClientService.layer,
).pipe(Layer.provideMerge(InfrastructureLive));
