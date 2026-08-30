import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import type { IntegrationRecord } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import {
	collectionSyncMatches,
	fetchEntity,
	integrationsDisabledForUser,
	jsonObject,
	listActiveIntegrations,
	logPushFailure,
	normalizeBaseUrl,
	resolveEntityProviderName,
	type IntegrationPushHost,
} from "../lib/integration-push";

export const manifest = defineManifest({
	kind: "automation",
	name: "Radarr Push",
	slug: "trigger.radarr-push",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	inputProjection: {
		event: { compareProperties: [], properties: ["entitySchemaSlug", "entityId"] },
	},
	capabilities: [
		"log",
		"httpCall",
		"executeRyotql",
		"getEntitySchemas",
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
			headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
		})
		.pipe(
			Effect.asVoid,
			Effect.catch((error) => logPushFailure(host, "Radarr", error)),
		);
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const payload = automation.payload;
		if (
			payload.category !== "change" ||
			payload.resource !== "event" ||
			payload.operation !== "create"
		) {
			return Effect.succeed(null);
		}

		return Effect.gen(function* () {
			const event = payload.after;
			const entitySchemaSlug = event.properties["entitySchemaSlug"];
			const entityId = event.properties["entityId"];
			if (entitySchemaSlug !== "movie" || typeof entityId !== "string") {
				return null;
			}
			const [disabled, integrations] = yield* Effect.all(
				[integrationsDisabledForUser(host), listActiveIntegrations(host, "radarr")],
				{ concurrency: "unbounded" },
			);
			if (disabled) {
				return null;
			}
			const matching = integrations.filter((integration) =>
				collectionSyncMatches(integration, event.entityId),
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
				{ discard: true, concurrency: 1 },
			);
			return null;
		});
	},
});
