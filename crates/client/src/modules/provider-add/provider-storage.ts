import type { ApiScope } from "@/api/request-key";
import { scopedStorageKey } from "@/persistence/keys";

export type ProviderAddProviderStorageScope = ApiScope & { entitySchemaSlug: string };

export const providerAddProviderStorageKey = (scope: ProviderAddProviderStorageScope) =>
	scopedStorageKey("provider-add:provider", scope, scope.entitySchemaSlug);
