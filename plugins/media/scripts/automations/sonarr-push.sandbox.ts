import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest, type IntegrationRecord } from "@ryot/sandbox-sdk/core";

import {
	collectionSyncMatches,
	fetchEntity,
	integrationsDisabledForUser,
	jsonObject,
	listActiveIntegrations,
	normalizeBaseUrl,
	resolveEntityProviderName,
	type IntegrationPushHost,
} from "../script-helpers/integration-push";

export const manifest = defineManifest({
	kind: "automation",
	name: "Sonarr Push",
	requiredAppConfigKeys: [],
	slug: "trigger.sonarr-push",
	capabilities: [
		"httpCall",
		"getEntity",
		"getEntitySchema",
		"listIntegrations",
		"getUserPreferences",
	],
});

const pushShowToSonarr = (
	host: IntegrationPushHost,
	integration: IntegrationRecord,
	tvdbId: string,
) => {
	const specifics = jsonObject(integration.providerSpecifics);
	const baseUrl = normalizeBaseUrl(specifics?.["baseUrl"]);
	const apiKey = specifics?.["apiKey"];
	if (!specifics || !baseUrl || typeof apiKey !== "string") {
		return Promise.resolve();
	}

	const requestBody = {
		monitored: true,
		tvdbId: Number(tvdbId),
		rootFolderPath: specifics["rootFolderPath"],
		addOptions: { searchForMissingEpisodes: true },
		qualityProfileId: Number(specifics["profileId"]),
		tags: typeof specifics["tagIds"] === "number" ? [specifics["tagIds"]] : [],
	};

	return host
		.httpCall("POST", `${baseUrl}/api/v3/series`, {
			body: JSON.stringify(requestBody),
			headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
		})
		.then((result) => {
			if (!result.success) {
				console.warn(`Sonarr push failed: ${result.error}`);
			}
			return undefined;
		});
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const event = automation.source.kind === "event" ? automation.source.after : undefined;
		const entitySchemaSlug = event?.properties["entitySchemaSlug"];
		const entityId = event?.properties["entityId"];
		if (!event || entitySchemaSlug !== "show" || typeof entityId !== "string") {
			return Promise.resolve(null);
		}

		return Promise.all([integrationsDisabledForUser(host), listActiveIntegrations(host, "sonarr")])
			.then(([disabled, integrations]) => {
				if (disabled) {
					return undefined;
				}
				const matching = integrations.filter((integration) =>
					collectionSyncMatches(integration, event.subject.id),
				);
				if (matching.length === 0) {
					return undefined;
				}
				return fetchEntity(host, entityId).then((entity) => {
					if (!entity) {
						return undefined;
					}
					return resolveEntityProviderName(host, entity).then((providerName) => {
						const externalId = entity.externalId;
						if (providerName !== "TVDB" || !externalId) {
							return undefined;
						}
						return matching.reduce(
							(current, integration) =>
								current.then(() => pushShowToSonarr(host, integration, externalId)),
							Promise.resolve(),
						);
					});
				});
			})
			.then(() => null);
	},
});
