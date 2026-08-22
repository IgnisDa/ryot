import { formatRelativeTime } from "#/modules/ui/run/run-status";

/**
 * Structural rather than derived from one row type: the RyotQL row and the contract's
 * `ListedIntegration` both feed these, and they brand `pluginSlug` differently.
 */
type IntegrationIdentity = {
	readonly provider: string;
	readonly pluginSlug: string;
	readonly name?: string | null;
};

export type IntegrationProviderNames = ReadonlyMap<string, string>;

/** Provider slugs are only unique within their plugin, so display names are keyed by both. */
export const integrationProviderKey = (input: {
	readonly provider: string;
	readonly pluginSlug: string;
}) => `${input.pluginSlug}:${input.provider}`;

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
	integration: { readonly lastFinishedAt: string | null },
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
