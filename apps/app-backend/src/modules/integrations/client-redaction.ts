import { collectSecretProperties } from "@ryot/contract/schema/property-schema";

import type { RegisteredIntegrationProvider } from "#modules/plugins/integration-provider-catalog";

import type { IntegrationRecord } from "./repository";

export type RegisteredProviderLookup = (
	providerSlug: string,
) => RegisteredIntegrationProvider | null;

/**
 * Client-facing boundary. `repository.normalizeIntegration` deliberately returns credentials
 * verbatim because the webhook path, the yank adapters, and the `getIntegration` host function
 * all need them; those consumers call the service's internal readers. Only the service methods
 * backing the `list` / `get` / `update` contract endpoints route through here.
 */
export const redactIntegrationForClient = (
	findProvider: RegisteredProviderLookup,
	integration: IntegrationRecord,
): IntegrationRecord => {
	const registered = findProvider(integration.provider);
	const secretKeys = registered ? collectSecretProperties(registered.settingsSchema) : [];
	if (secretKeys.length === 0) {
		return integration;
	}
	const providerSpecifics = { ...integration.providerSpecifics };
	for (const key of secretKeys) {
		Reflect.deleteProperty(providerSpecifics, key);
	}
	return { ...integration, providerSpecifics };
};
