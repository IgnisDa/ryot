import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";
import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

import { ingestionReadinessRequirement } from "#/modules/imports/readiness-presentation";
import type { IntegrationProviderItem } from "#/modules/integrations/service";
import { type CatalogEntry, pluginCatalogGroup } from "#/modules/ui/catalog/selection";

export const integrationProviderItemKey = (provider: Pick<IntegrationProviderItem, "reference">) =>
	definitionKey("integration-provider", provider.reference.owner, provider.reference.slug);

export const integrationLotLabel = (lot: IntegrationLot) =>
	kernelMessage("client.integrations.lot.label", { lot });

export const integrationLotDetail = (lot: IntegrationLot) =>
	kernelMessage("client.integrations.lot.detail", { lot });

const integrationProviderRequirement = (
	provider: IntegrationProviderItem,
	t: (message: Message) => Text,
) => {
	if (!provider.isCreatable) {
		return t(
			provider.entitlement === null
				? kernelMessage("client.ui.wizard.service.installation-unavailable")
				: kernelMessage("client.integrations.pro-required"),
		);
	}
	return ingestionReadinessRequirement(t, provider.readiness, provider.pluginScope);
};

export const integrationProviderEntry = (
	provider: IntegrationProviderItem,
	t: (message: Message) => Text,
	pluginNames: ReadonlyMap<string, Message>,
): CatalogEntry => ({
	name: t(provider.name),
	description: t(provider.description),
	key: integrationProviderItemKey(provider),
	badge: t(integrationLotLabel(provider.lot)),
	requirement: integrationProviderRequirement(provider, t),
	isAvailable: provider.isCreatable && provider.readiness.ready,
	group: pluginCatalogGroup(
		{
			...provider,
			pluginName:
				provider.installationId === null ? undefined : pluginNames.get(provider.installationId),
		},
		t,
	),
});

export const integrationProviderChooseLabel = (
	t: (message: Message) => Text,
	entry: CatalogEntry,
) =>
	t(
		entry.isAvailable
			? kernelMessage("client.integrations.choose.available", { name: entry.name })
			: kernelMessage("client.ui.wizard.unavailable", { name: entry.name }),
	);

export const integrationProviderNames = (
	providers: readonly IntegrationProviderItem[],
	t: (message: Message) => Text,
) => new Map(providers.map((provider) => [integrationProviderItemKey(provider), t(provider.name)]));

export const findOwnedIntegrationProvider = (
	providers: readonly IntegrationProviderItem[],
	owner: undefined | { readonly provider: string; readonly pluginId: null | string },
) =>
	owner === undefined
		? undefined
		: providers.find(
				(provider) => provider.slug === owner.provider && provider.pluginId === owner.pluginId,
			);
