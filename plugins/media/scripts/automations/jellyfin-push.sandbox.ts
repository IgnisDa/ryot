import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import type { IntegrationRecord } from "@ryot/sandbox-sdk/core";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import {
	fetchEntity,
	integrationsDisabledForUser,
	jsonObject,
	listActiveIntegrations,
	normalizeBaseUrl,
	parseJsonBody,
	resolveEntityProviderName,
	type IntegrationPushHost,
} from "../script-helpers/integration-push";

const JELLYFIN_AUTH_HEADER =
	'MediaBrowser Client="Ryot", Device="Ryot", DeviceId="ryot-integration", Version="2.0.0"';

export const manifest = defineManifest({
	kind: "automation",
	name: "Jellyfin Push",
	slug: "trigger.jellyfin-push",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: [
		"httpCall",
		"getEntities",
		"getEntitySchemas",
		"listIntegrations",
		"getUserPreferences",
	],
});

type JellyfinSession = { readonly userId: string; readonly accessToken: string };
type JellyfinItem = { readonly tmdbId: string | null; readonly title: string | null };

const authenticateJellyfin = (
	host: IntegrationPushHost,
	baseUrl: string,
	username: string,
	password: unknown,
) =>
	host
		.httpCall("POST", `${baseUrl}/Users/AuthenticateByName`, {
			body: JSON.stringify({
				Username: username,
				Pw: typeof password === "string" ? password : "",
			}),
			headers: {
				"Content-Type": "application/json",
				"X-Emby-Authorization": JELLYFIN_AUTH_HEADER,
			},
		})
		.pipe(
			Effect.map((result): JellyfinSession | null => {
				const payload = jsonObject(parseJsonBody(result));
				const user = jsonObject(payload?.["User"]);
				const accessToken = payload?.["AccessToken"];
				const userId = user?.["Id"];
				return typeof accessToken === "string" && typeof userId === "string"
					? { userId, accessToken }
					: null;
			}),
			Effect.catch(() => Effect.succeed(null)),
		);

const findJellyfinItemId = (
	host: IntegrationPushHost,
	baseUrl: string,
	session: JellyfinSession,
	item: JellyfinItem,
) => {
	const params = new URLSearchParams();
	params.set("Recursive", "true");
	params.set("Fields", "ProviderIds");
	params.set("IncludeItemTypes", "Movie,Series");
	if (item.title) {
		params.set("SearchTerm", item.title);
	}

	return host
		.httpCall(
			"GET",
			`${baseUrl}/Users/${encodeURIComponent(session.userId)}/Items?${params.toString()}`,
			{ headers: { "X-Emby-Token": session.accessToken } },
		)
		.pipe(
			Effect.map((result) => {
				const payload = jsonObject(parseJsonBody(result));
				const items = Array.isArray(payload?.["Items"]) ? payload["Items"] : [];
				if (item.tmdbId) {
					const matched = items.find((value) => {
						const entry = jsonObject(value);
						const providerIds = jsonObject(entry?.["ProviderIds"]);
						return String(providerIds?.["Tmdb"]) === item.tmdbId;
					});
					const matchedId = jsonObject(matched)?.["Id"];
					if (typeof matchedId === "string") {
						return matchedId;
					}
				}
				if (item.title) {
					const title = item.title.toLowerCase();
					const matched = items.find((value) => {
						const name = jsonObject(value)?.["Name"];
						return typeof name === "string" && name.toLowerCase() === title;
					});
					const matchedId = jsonObject(matched)?.["Id"];
					return typeof matchedId === "string" ? matchedId : null;
				}
				return null;
			}),
			Effect.catch(() => Effect.succeed(null)),
		);
};

const markPlayedInJellyfin = (
	host: IntegrationPushHost,
	integration: IntegrationRecord,
	item: JellyfinItem,
) => {
	const specifics = jsonObject(integration.providerSpecifics);
	const baseUrl = normalizeBaseUrl(specifics?.["baseUrl"]);
	const username = specifics?.["username"];
	if (!baseUrl || typeof username !== "string") {
		return Effect.void;
	}

	return Effect.gen(function* () {
		const session = yield* authenticateJellyfin(host, baseUrl, username, specifics?.["password"]);
		if (!session) {
			return;
		}
		const itemId = yield* findJellyfinItemId(host, baseUrl, session, item);
		if (!itemId) {
			return;
		}
		yield* host
			.httpCall(
				"POST",
				`${baseUrl}/Users/${encodeURIComponent(session.userId)}/PlayedItems/${encodeURIComponent(itemId)}`,
				{ headers: { "X-Emby-Token": session.accessToken } },
			)
			.pipe(
				Effect.asVoid,
				Effect.catch((error) =>
					Effect.sync(() => console.warn(`Jellyfin push failed: ${error.message}`)),
				),
			);
	});
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const event = automation.source.kind === "event" ? automation.source.after : undefined;
		const entitySchemaSlug = event?.subject.entitySchemaSlug;
		if (!event || (entitySchemaSlug !== "movie" && entitySchemaSlug !== "show")) {
			return Effect.succeed(null);
		}

		return Effect.gen(function* () {
			const [disabled, integrations] = yield* Effect.all(
				[integrationsDisabledForUser(host), listActiveIntegrations(host, "jellyfin_push")],
				{ concurrency: "unbounded" },
			);
			if (disabled || integrations.length === 0) {
				return null;
			}
			const entity = yield* fetchEntity(host, event.subject.id);
			const providerName = yield* resolveEntityProviderName(host, entity);
			const tmdbId = providerName === "TMDB" ? entity.externalId : null;
			const title = entity.name || null;
			if (!tmdbId && !title) {
				return null;
			}
			yield* Effect.forEach(
				integrations,
				(integration) => markPlayedInJellyfin(host, integration, { tmdbId, title }),
				{ concurrency: 1, discard: true },
			);
			return null;
		});
	},
});
