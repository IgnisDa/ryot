import type { SandboxProviderId } from "@ryot/contract/schema/brands";

import type { ProviderSearchSummary } from "./state";

export const selectPreferredProvider = (
	providers: readonly ProviderSearchSummary[],
	remembered: SandboxProviderId | null,
) => providers.find((provider) => provider.providerId === remembered) ?? providers.at(0);
