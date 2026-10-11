import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";

import { ingestionReadinessRequirement } from "#/modules/imports/readiness-presentation";
import { integrationProviderKey } from "#/modules/integrations/presentation";
import type { IntegrationProviderItem } from "#/modules/integrations/service";
import {
	pluginCatalogGroup,
	pluginHeading,
	type CatalogEntry,
} from "#/modules/ui/catalog/selection";

export const PRO_REQUIRED_INTEGRATION_MESSAGE = "Ryot Pro is required to use this integration.";

const lotLabels = { push: "Push", sink: "Webhook", yank: "Scheduled" } as const satisfies Record<
	IntegrationLot,
	string
>;

export const integrationLotLabel = (lot: IntegrationLot) => lotLabels[lot];

export const integrationLotDetail = (lot: IntegrationLot) => {
	if (lot === "sink") {
		return "This service posts to a webhook URL that Ryot gives you once the integration exists.";
	}
	return lot === "yank"
		? "Ryot checks this service on a schedule and brings across what it finds."
		: "Ryot pushes changes out to this service as your library changes.";
};

const integrationProviderRequirement = (provider: IntegrationProviderItem) => {
	if (!provider.isCreatable) {
		return provider.requiresProKey
			? PRO_REQUIRED_INTEGRATION_MESSAGE
			: "This service is unavailable in this plugin installation.";
	}
	return ingestionReadinessRequirement(provider.readiness, provider.pluginScope);
};

export const integrationProviderEntry = (provider: IntegrationProviderItem): CatalogEntry => ({
	name: provider.name,
	description: provider.description,
	badge: integrationLotLabel(provider.lot),
	requirement: integrationProviderRequirement(provider),
	isAvailable: provider.isCreatable && provider.readiness.ready,
	slug: integrationProviderKey({ provider: provider.slug, pluginId: provider.pluginId }),
	group:
		provider.reference.owner.kind === "kernel"
			? { key: "kernel", heading: "Ryot" }
			: pluginCatalogGroup({
					scope: provider.pluginScope,
					reference: provider.reference,
					packageId: provider.packageId,
					name: provider.packageId === null ? provider.name : pluginHeading(provider.packageId),
				}),
});

export const integrationProviderChooseLabel = (entry: CatalogEntry) =>
	entry.isAvailable ? `Connect ${entry.name}` : `${entry.name} is unavailable`;

export const integrationProviderNames = (providers: readonly IntegrationProviderItem[]) =>
	new Map(
		providers.map((provider) => [
			integrationProviderKey({ provider: provider.slug, pluginId: provider.pluginId }),
			provider.name,
		]),
	);

export const findOwnedIntegrationProvider = (
	providers: readonly IntegrationProviderItem[],
	owner: { readonly provider: string; readonly pluginId: string | null } | undefined,
) =>
	owner === undefined
		? undefined
		: providers.find(
				(provider) => provider.slug === owner.provider && provider.pluginId === owner.pluginId,
			);
