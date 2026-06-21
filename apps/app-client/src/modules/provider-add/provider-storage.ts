import { normalizeServerOrigin } from "@/api/origin";
import type { ApiScope } from "@/api/request-key";

export type ProviderAddProviderStorageScope = ApiScope & { entitySchemaSlug: string };

export const providerAddProviderStorageKey = (scope: ProviderAddProviderStorageScope) =>
	`provider-add:provider:${JSON.stringify([
		normalizeServerOrigin(scope.serverUrl),
		scope.userId,
		scope.entitySchemaSlug,
	])}`;
