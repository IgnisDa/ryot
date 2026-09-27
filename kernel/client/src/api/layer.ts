import { Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { AdminApi } from "#/api/admin";
import { AuthenticatedApi } from "#/api/authenticated";
import { AutomationHistoryApi } from "#/api/automation-history";
import { BackupsApi } from "#/api/backups";
import { ClientPagesApi } from "#/api/client-pages";
import { CollectionsApi } from "#/api/collections";
import { EntityInterestApi } from "#/api/entity-interest";
import { GodModeApi } from "#/api/god-mode";
import { ImportsApi } from "#/api/imports";
import { IntegrationsApi } from "#/api/integrations";
import { NotificationsApi } from "#/api/notifications";
import { OAuthConnectionsApi } from "#/api/oauth-connections";
import { PluginInstallationsApi } from "#/api/plugin-installations";
import { PluginsApi } from "#/api/plugins";
import { ProviderEntitiesApi } from "#/api/provider-entities";
import { PublicApi } from "#/api/public";
import { RyotQLApi } from "#/api/ryotql";
import { SavedViewsApi } from "#/api/saved-views";
import { UploadsApi } from "#/api/uploads";
import { UserSettingsApi } from "#/api/user-settings";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { OAuthTokenService } from "#/modules/auth/token-service";

export const TransportLive = Layer.mergeAll(AdminApi.layer, AuthenticatedApi.layer).pipe(
	Layer.provideMerge(OAuthTokenService.layer),
	Layer.provideMerge(RuntimeOAuthClientService.layer),
	Layer.provideMerge(FetchHttpClient.layer),
);

export const ApiLive = Layer.mergeAll(
	PublicApi.layer,
	AutomationHistoryApi.layer,
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
	OAuthConnectionsApi.layer,
	ProviderEntitiesApi.layer,
	PluginInstallationsApi.layer,
).pipe(Layer.provide(TransportLive));
