import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";

import { formatRelativeTime } from "#/modules/ui/run/run-status";

export type IntegrationProviderNames = ReadonlyMap<string, string>;

type IntegrationIdentity = {
	readonly provider: string;
	readonly name?: null | string;
	readonly pluginId: null | string;
};

export const integrationProviderKey = (input: {
	readonly provider: string;
	readonly pluginId: null | string;
}) => definitionKey("integration-provider", definitionOwner(input.pluginId), input.provider);

export const integrationProviderName = (
	integration: IntegrationIdentity,
	names: IntegrationProviderNames,
) => names.get(integrationProviderKey(integration)) ?? integration.provider;

export const integrationTitle = (
	integration: IntegrationIdentity,
	names: IntegrationProviderNames,
) => {
	const trimmed = integration.name?.trim();
	return trimmed === undefined || trimmed === ""
		? integrationProviderName(integration, names)
		: trimmed;
};

export const integrationStateLabel = (integration: { readonly isDisabled: boolean }) =>
	integration.isDisabled ? "Paused" : "Active";

export const integrationSyncLabel = (
	integration: { readonly lastFinishedAt: null | string },
	nowMs: number,
) =>
	integration.lastFinishedAt === null
		? "Never synced"
		: `Synced ${formatRelativeTime(integration.lastFinishedAt, nowMs)}`;

export const integrationDeleteConfirmation = (
	integration: IntegrationIdentity,
	names: IntegrationProviderNames,
) =>
	`${integrationTitle(integration, names)} will stop syncing and its settings will be removed. Anything it already brought into your library stays.`;
