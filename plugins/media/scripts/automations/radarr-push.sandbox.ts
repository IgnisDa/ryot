import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import type { IntegrationRecord } from "@ryot/sandbox-sdk/core";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

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
	name: "Radarr Push",
	slug: "trigger.radarr-push",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
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
		return Effect.void;
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
		.pipe(
			Effect.asVoid,
			Effect.catchAll((error) =>
				Effect.sync(() => console.warn(`Radarr push failed: ${error.message}`)),
			),
		);
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const event = automation.source.kind === "event" ? automation.source.after : undefined;
		const entitySchemaSlug = event?.properties["entitySchemaSlug"];
		const entityId = event?.properties["entityId"];
		if (!event || entitySchemaSlug !== "movie" || typeof entityId !== "string") {
			return Effect.succeed(null);
		}

		return Effect.gen(function* () {
			const [disabled, integrations] = yield* Effect.all(
				[integrationsDisabledForUser(host), listActiveIntegrations(host, "radarr")],
				{ concurrency: "unbounded" },
			);
			if (disabled) {
				return null;
			}
			const matching = integrations.filter((integration) =>
				collectionSyncMatches(integration, event.subject.id),
			);
			if (matching.length === 0) {
				return null;
			}
			const entity = yield* fetchEntity(host, entityId);
			const providerName = yield* resolveEntityProviderName(host, entity);
			const externalId = entity.externalId;
			if (providerName !== "TMDB" || !externalId) {
				return null;
			}
			yield* Effect.forEach(
				matching,
				(integration) => pushMovieToRadarr(host, integration, externalId),
				{ concurrency: 1, discard: true },
			);
			return null;
		});
	},
});
