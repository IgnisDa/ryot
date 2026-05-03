import type { ListedIntegrationProvider } from "@ryot/contract/modules/integrations/schemas";
import type { IntegrationLot } from "@ryot/contract/modules/integrations/types";

import type { CatalogEntry } from "@/modules/ui/plugin-catalog/catalog-selection";

const lotLabels = {
	push: "Push",
	sink: "Webhook",
	yank: "Scheduled",
} as const satisfies Record<IntegrationLot, string>;

export const integrationLotLabel = (lot: IntegrationLot) => lotLabels[lot];

export const integrationLotDetail = (lot: IntegrationLot) => {
	if (lot === "sink") {
		return "This service posts to a webhook URL that Ryot gives you once the integration exists.";
	}
	return lot === "yank"
		? "Ryot checks this service on a schedule and brings across what it finds."
		: "Ryot pushes changes out to this service as your library changes.";
};

export const integrationProviderEntry = (provider: ListedIntegrationProvider): CatalogEntry => ({
	slug: provider.slug,
	name: provider.name,
	description: provider.description,
	isAvailable: provider.isCreatable,
	badge: integrationLotLabel(provider.lot),
	requirement: provider.isCreatable ? undefined : "This service is not ready on your server yet.",
});

export const integrationProviderChooseLabel = (entry: CatalogEntry) =>
	entry.isAvailable ? `Connect ${entry.name}` : `${entry.name} is unavailable`;

/** Provider slugs are only unique within a plugin, so an owned integration matches on both. */
export const findOwnedIntegrationProvider = (
	providers: readonly ListedIntegrationProvider[],
	owner: { readonly provider: string; readonly pluginSlug: string } | undefined,
) =>
	owner === undefined
		? undefined
		: providers.find(
				(provider) => provider.slug === owner.provider && provider.pluginSlug === owner.pluginSlug,
			);
