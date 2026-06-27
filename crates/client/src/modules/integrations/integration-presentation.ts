import { formatRelativeTime } from "@/modules/ui/run/run-status";

import { integrationProviderKey } from "./state";

/**
 * Structural rather than derived from one row type: the RyotQL row and the contract's
 * `ListedIntegration` both feed these, and they brand `pluginSlug` differently.
 */
type IntegrationIdentity = {
	readonly provider: string;
	readonly pluginSlug: string;
	readonly name?: string | null;
};

export const integrationProviderName = (
	integration: IntegrationIdentity,
	names: ReadonlyMap<string, string>,
) => names.get(integrationProviderKey(integration)) ?? integration.provider;

export const integrationTitle = (
	integration: IntegrationIdentity,
	names: ReadonlyMap<string, string>,
) => {
	const trimmed = integration.name?.trim();
	return trimmed === undefined || trimmed === ""
		? integrationProviderName(integration, names)
		: trimmed;
};

export const integrationSyncLabel = (
	integration: { readonly lastFinishedAt: string | null },
	nowMs: number,
) =>
	integration.lastFinishedAt === null
		? "Never synced"
		: `Synced ${formatRelativeTime(integration.lastFinishedAt, nowMs)}`;

export const integrationStateLabel = (integration: { readonly isDisabled: boolean }) =>
	integration.isDisabled ? "Paused" : "Active";

export const integrationDeleteConfirmation = (
	integration: IntegrationIdentity,
	names: ReadonlyMap<string, string>,
) =>
	`${integrationTitle(integration, names)} will stop syncing and its settings will be removed. Anything it already brought into your library stays.`;
