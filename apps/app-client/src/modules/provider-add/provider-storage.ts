import type { ApiScope } from "@/api/request-key";
import { normalizeServerOrigin } from "@/modules/server/url";

export type ProviderAddProviderStorageScope = ApiScope & { entitySchemaSlug: string };

export const providerAddProviderStorageKey = (scope: ProviderAddProviderStorageScope) =>
	`provider-add:provider:${JSON.stringify([
		normalizeServerOrigin(scope.serverUrl),
		scope.userId,
		scope.entitySchemaSlug,
	])}`;
