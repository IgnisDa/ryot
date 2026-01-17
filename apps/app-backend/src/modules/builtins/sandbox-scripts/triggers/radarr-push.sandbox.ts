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
	name: "Radarr Push",
	mode: "after_create",
	slug: "trigger.radarr-push",
	requiredAppConfigKeys: [],
	capabilities: [
		"httpCall",
		"getEntity",
		"getEntitySchema",
		"listIntegrations",
		"getUserPreferences",
	],
});

const pushMovieToRadarr = (
	host: IntegrationPushHost,
	integration: IntegrationRecord,
	tmdbId: string,
) => {
	const specifics = jsonObject(integration.providerSpecifics);
	const baseUrl = normalizeBaseUrl(specifics?.["baseUrl"]);
	const apiKey = specifics?.["apiKey"];
	if (!specifics || !baseUrl || typeof apiKey !== "string") {
		return Promise.resolve();
	}

	const requestBody = {
		monitored: true,
		tmdbId: Number(tmdbId),
		addOptions: { searchForMovie: true },
		rootFolderPath: specifics["rootFolderPath"],
		qualityProfileId: Number(specifics["profileId"]),
		tags: Array.isArray(specifics["tagIds"]) ? specifics["tagIds"] : [],
	};

	return host
		.httpCall("POST", `${baseUrl}/api/v3/movie`, {
			body: JSON.stringify(requestBody),
			headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
		})
		.then((result) => {
			if (!result.success) {
				console.warn(`Radarr push failed: ${result.error}`);
			}
			return undefined;
		});
};

export default defineAfterCreateTrigger({
	manifest,
	run: ({ trigger }, host) => {
		const entitySchemaSlug = trigger.properties["entitySchemaSlug"];
		const entityId = trigger.properties["entityId"];
		if (entitySchemaSlug !== "movie" || typeof entityId !== "string") {
			return Promise.resolve();
		}

		return Promise.all([
			integrationsDisabledForUser(host),
			listActiveIntegrations(host, "radarr"),
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
					if (providerName !== "TMDB" || !externalId) {
						return undefined;
					}
					return matching.reduce(
						(current, integration) =>
							current.then(() => pushMovieToRadarr(host, integration, externalId)),
						Promise.resolve(),
					);
				});
			});
		});
	},
});
