import { collectSecretProperties } from "@ryot/contract/schema/property-schema";

import type { RegisteredIntegrationProvider } from "#modules/plugins/integration-provider-catalog";

import type { IntegrationRecord } from "./repository";

export type RegisteredProviderLookup = (
	providerSlug: string,
) => RegisteredIntegrationProvider | null;

/**
 * Client-facing boundary. `repository.normalizeIntegration` deliberately returns credentials
 * verbatim because integration scripts read them through the `getIntegration` host function.
 * Only the service methods
 * backing the `list` / `get` / `update` contract endpoints route through here.
 */
export const redactIntegrationForClient = (
	findProvider: RegisteredProviderLookup,
	integration: IntegrationRecord,
): IntegrationRecord => {
	const registered = findProvider(integration.provider);
	if (!registered) {
		const kind = integration.providerSpecifics["kind"];
		const providerSpecifics = typeof kind === "string" ? { kind } : {};
		return { ...integration, providerSpecifics };
	}
	const secretKeys = collectSecretProperties(registered.settingsSchema);
	if (secretKeys.length === 0) {
		return integration;
	}
	const providerSpecifics = { ...integration.providerSpecifics };
	for (const key of secretKeys) {
		Reflect.deleteProperty(providerSpecifics, key);
	}
	return { ...integration, providerSpecifics };
};
