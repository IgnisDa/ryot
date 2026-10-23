import type { SandboxProviderId } from "@ryot-app/contract/schema/brands";

import type { ProviderSearchSummary } from "#/modules/provider-add/service";

export const selectPreferredProvider = (
	providers: readonly ProviderSearchSummary[],
	remembered: SandboxProviderId | null,
) => providers.find((provider) => provider.providerId === remembered) ?? providers.at(0);
