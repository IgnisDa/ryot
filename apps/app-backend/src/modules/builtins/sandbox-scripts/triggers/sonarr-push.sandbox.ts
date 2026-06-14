import { defineManifest, type IntegrationRecord } from "@ryot/sandbox-sdk";
import { defineAfterCreateTrigger } from "@ryot/sandbox-sdk/trigger";

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
	kind: "trigger",
	name: "Sonarr Push",
	mode: "after_create",
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

export default defineAfterCreateTrigger({
	manifest,
	run: ({ trigger }, host) => {
		const entitySchemaSlug = trigger.properties["entitySchemaSlug"];
		const entityId = trigger.properties["entityId"];
		if (entitySchemaSlug !== "show" || typeof entityId !== "string") {
			return Promise.resolve();
		}

		return Promise.all([
			integrationsDisabledForUser(host),
			listActiveIntegrations(host, "sonarr"),
		]).then(([disabled, integrations]) => {
			if (disabled) {
				return undefined;
			}
			const matching = integrations.filter((integration) =>
				collectionSyncMatches(integration, trigger.entityId),
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
		});
	},
});
