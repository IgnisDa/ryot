import { Layer } from "effect";

import { IntegrationProviderCatalog } from "#modules/plugins/catalog/integration-providers";
import { PluginConfigEncryptionKey } from "#modules/plugins/configuration/encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/configuration/revisions";

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
