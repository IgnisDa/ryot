const JELLYFIN_AUTH_HEADER =
	'MediaBrowser Client="Ryot", Device="Ryot", DeviceId="ryot-integration", Version="2.0.0"';

async function authenticateJellyfin(baseUrl, username, password, effectPrefix) {
	const result = await httpCall(
		"POST",
		baseUrl + "/Users/AuthenticateByName",
		{
			body: JSON.stringify({
				Username: username,
				Pw: typeof password === "string" ? password : "",
			}),
			headers: { "Content-Type": "application/json", "X-Emby-Authorization": JELLYFIN_AUTH_HEADER },
		},
		effectPrefix + ":authenticate",
	);
	if (!result.success) {
		return null;
	}

	const payload = parseJsonBody(result);
	const accessToken =
		payload && typeof payload.AccessToken === "string" ? payload.AccessToken : null;
	const userId = payload?.User && typeof payload.User.Id === "string" ? payload.User.Id : null;
	if (!accessToken || !userId) {
		return null;
	}

	return { userId: userId, accessToken: accessToken };
}

async function findJellyfinItemId(baseUrl, session, item, effectPrefix) {
	const params = new URLSearchParams();
	params.set("Recursive", "true");
	params.set("Fields", "ProviderIds");
	params.set("IncludeItemTypes", "Movie,Series");
	if (item.title) {
		params.set("SearchTerm", item.title);
	}

	const result = await httpCall(
		"GET",
		baseUrl + "/Users/" + encodeURIComponent(session.userId) + "/Items?" + params.toString(),
		{ headers: { "X-Emby-Token": session.accessToken } },
		effectPrefix + ":find-item",
	);
	if (!result.success) {
		return null;
	}

	const payload = parseJsonBody(result);
	const items = payload && Array.isArray(payload.Items) ? payload.Items : [];

	if (item.tmdbId) {
		const byTmdb = items.find(function (entry) {
			return entry?.ProviderIds && String(entry.ProviderIds.Tmdb) === String(item.tmdbId);
		});
		if (byTmdb && typeof byTmdb.Id === "string") {
			return byTmdb.Id;
		}
	}

	if (item.title) {
		const byName = items.find(function (entry) {
			return (
				entry &&
				typeof entry.Name === "string" &&
				entry.Name.toLowerCase() === item.title.toLowerCase()
			);
		});
		if (byName && typeof byName.Id === "string") {
			return byName.Id;
		}
	}

	return null;
}

async function markPlayedInJellyfin(integration, item) {
	const specifics = integration.providerSpecifics ?? {};
	const baseUrl = normalizeBaseUrl(specifics.baseUrl);
	if (!baseUrl || typeof specifics.username !== "string") {
		return;
	}

	const effectPrefix = "jellyfin:" + String(integration.id);
	const session = await authenticateJellyfin(
		baseUrl,
		specifics.username,
		specifics.password,
		effectPrefix,
	);
	if (!session) {
		return;
	}

	const itemId = await findJellyfinItemId(baseUrl, session, item, effectPrefix);
	if (!itemId) {
		return;
	}

	const result = await httpCall(
		"POST",
		baseUrl +
			"/Users/" +
			encodeURIComponent(session.userId) +
			"/PlayedItems/" +
			encodeURIComponent(itemId),
		{ headers: { "X-Emby-Token": session.accessToken } },
		effectPrefix + ":mark-played:" + String(itemId),
	);
	if (!result.success) {
		console.warn("Jellyfin push failed: " + String(result.error));
	}
}

driver("subscription", async function (context) {
	const source = context.automation?.source;
	const trigger = source?.kind === "event" ? source.after : null;
	if (!trigger) {
		return;
	}
	if (trigger.entitySchemaSlug !== "movie" && trigger.entitySchemaSlug !== "show") {
		return;
	}

	const preamble = await Promise.all([
		integrationsDisabledForUser(),
		listActiveIntegrations("jellyfin_push"),
	]);
	if (preamble[0] || preamble[1].length === 0) {
		return;
	}
	const integrations = preamble[1];

	const entity = await fetchEntity(trigger.entityId);
	if (!entity) {
		return;
	}

	const providerName = await resolveEntityProviderName(entity);
	const tmdbId =
		providerName === "TMDB" && typeof entity.externalId === "string" ? entity.externalId : null;
	const title = typeof entity.name === "string" ? entity.name : null;
	if (!tmdbId && !title) {
		return;
	}

	for (const integration of integrations) {
		await markPlayedInJellyfin(integration, { tmdbId: tmdbId, title: title });
	}
});
