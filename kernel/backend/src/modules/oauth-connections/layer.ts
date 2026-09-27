import { Layer } from "effect";

import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";

import { OAuthConnectionsRepository } from "./repository";
import { OAuthConnectionsService } from "./service";
import { OAuthTokenClient } from "./token-client";

export const OAuthConnectionsServiceLive = OAuthConnectionsService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			OAuthTokenClient.layer,
			PluginConfigRevisions.layer,
			PluginConfigEncryptionKey.layer,
			IntegrationProviderCatalog.layer,
			OAuthConnectionsRepository.layer,
		),
	),
);
