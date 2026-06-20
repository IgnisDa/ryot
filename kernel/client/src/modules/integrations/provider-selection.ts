import type { ListedIntegrationProvider } from "@ryot-app/contract/modules/integrations/schemas";
import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";

import { integrationProviderKey } from "#/modules/integrations/presentation";

const UNTITLED_PLUGIN_HEADING = "Other";

export const PRO_REQUIRED_INTEGRATION_MESSAGE = "Ryot Pro is required to use this integration.";

const lotLabels = {
	push: "Push",
	sink: "Webhook",
	yank: "Scheduled",
} as const satisfies Record<IntegrationLot, string>;

export type CatalogEntry = {
	readonly slug: string;
	readonly name: string;
	readonly badge: string;
	readonly description: string;
	readonly isAvailable: boolean;
	readonly requirement: string | undefined;
};

export type CatalogGroup = {
	readonly heading: string;
	readonly pluginSlug: string;
	readonly entries: readonly CatalogEntry[];
};

export const integrationLotLabel = (lot: IntegrationLot) => lotLabels[lot];

export const integrationLotDetail = (lot: IntegrationLot) => {
	if (lot === "sink") {
		return "This service posts to a webhook URL that Ryot gives you once the integration exists.";
	}
	return lot === "yank"
		? "Ryot checks this service on a schedule and brings across what it finds."
		: "Ryot pushes changes out to this service as your library changes.";
};

const integrationProviderRequirement = (provider: ListedIntegrationProvider) => {
	if (provider.isCreatable) {
		return undefined;
	}
	return provider.requiresProKey
		? PRO_REQUIRED_INTEGRATION_MESSAGE
		: "This service is not ready on your server yet.";
};

export const integrationProviderEntry = (provider: ListedIntegrationProvider): CatalogEntry => ({
	slug: provider.slug,
	name: provider.name,
	description: provider.description,
	isAvailable: provider.isCreatable,
	badge: integrationLotLabel(provider.lot),
	requirement: integrationProviderRequirement(provider),
});

export const integrationProviderChooseLabel = (entry: CatalogEntry) =>
	entry.isAvailable ? `Connect ${entry.name}` : `${entry.name} is unavailable`;

export const integrationProviderNames = (providers: readonly ListedIntegrationProvider[]) =>
	new Map(
		providers.map((provider) => [
			integrationProviderKey({ provider: provider.slug, pluginSlug: provider.pluginSlug }),
			provider.name,
		]),
	);

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

export const findProviderBySlug = (
	providers: readonly ListedIntegrationProvider[],
	slug: string | undefined,
) => (slug === undefined ? undefined : providers.find((provider) => provider.slug === slug));

export const pluginHeading = (pluginSlug: string) => {
	const words = pluginSlug
		.split(/[-_\s]+/)
		.filter((part) => part.length > 0)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`);
	return words.length === 0 ? UNTITLED_PLUGIN_HEADING : words.join(" ");
};

const matchesCatalogQuery = (provider: ListedIntegrationProvider, query: string) => {
	const needle = query.trim().toLowerCase();
	return (
		needle.length === 0 ||
		provider.name.toLowerCase().includes(needle) ||
		provider.description.toLowerCase().includes(needle)
	);
};

export const groupIntegrationProviders = (
	providers: readonly ListedIntegrationProvider[],
	query: string,
): readonly CatalogGroup[] => {
	const matched = providers.filter((provider) => matchesCatalogQuery(provider, query));
	return [...new Set(matched.map((provider) => provider.pluginSlug))].map((pluginSlug) => ({
		pluginSlug,
		heading: pluginHeading(pluginSlug),
		entries: matched
			.filter((provider) => provider.pluginSlug === pluginSlug)
			.map(integrationProviderEntry)
			.sort((left, right) => left.name.localeCompare(right.name)),
	}));
};

export const availableCatalogEntries = (groups: readonly CatalogGroup[]) =>
	groups.flatMap((group) => group.entries.filter((entry) => entry.isAvailable));
