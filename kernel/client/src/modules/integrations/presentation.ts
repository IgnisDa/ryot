import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

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
	kernelMessage("client.integrations.state", {
		state: integration.isDisabled ? "paused" : "active",
	});

export const integrationSyncLabel = (
	formatters: Formatters,
	t: (message: Message) => Text,
	integration: { readonly lastFinishedAt: null | string },
	nowMs: number,
) =>
	integration.lastFinishedAt === null
		? kernelMessage("client.integrations.sync.never")
		: kernelMessage("client.integrations.sync.synced", {
				when: formatRelativeTime(formatters, t, integration.lastFinishedAt, nowMs),
			});

export const integrationDeleteConfirmation = (
	integration: IntegrationIdentity,
	names: IntegrationProviderNames,
) =>
	kernelMessage("client.integrations.delete-detail", {
		title: integrationTitle(integration, names),
	});
