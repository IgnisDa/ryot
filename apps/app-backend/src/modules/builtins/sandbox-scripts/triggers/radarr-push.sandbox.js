async function pushMovieToRadarr(integration, tmdbId) {
	const specifics = integration.providerSpecifics ?? {};
	const baseUrl = normalizeBaseUrl(specifics.baseUrl);
	if (!baseUrl || typeof specifics.apiKey !== "string") {
		return;
	}

	const requestBody = {
		monitored: true,
		tmdbId: Number(tmdbId),
		rootFolderPath: specifics.rootFolderPath,
		addOptions: { searchForMovie: true },
		qualityProfileId: Number(specifics.profileId),
		tags: Array.isArray(specifics.tagIds) ? specifics.tagIds : [],
	};

	const result = await httpCall(
		"POST",
		baseUrl + "/api/v3/movie",
		{
			body: JSON.stringify(requestBody),
			headers: { "Content-Type": "application/json", "X-Api-Key": specifics.apiKey },
		},
		"radarr:" + String(integration.id) + ":" + String(tmdbId),
	);

	if (!result.success) {
		// Radarr replies 409 when the movie already exists; that is expected, not an error.
		console.warn("Radarr push failed: " + String(result.error));
	}
}

driver("subscription", async function (context) {
	const source = context.automation?.source;
	const trigger = source?.kind === "event" ? source.after : null;
	if (!trigger) {
		return;
	}

	const properties =
		trigger.properties && typeof trigger.properties === "object" ? trigger.properties : {};
	if (properties.entitySchemaSlug !== "movie") {
		return;
	}

	const preamble = await Promise.all([
		integrationsDisabledForUser(),
		listActiveIntegrations("radarr"),
	]);
	if (preamble[0]) {
		return;
	}
	const matchingIntegrations = preamble[1].filter(function (integration) {
		return collectionSyncMatches(integration, trigger.entityId);
	});
	if (matchingIntegrations.length === 0) {
		return;
	}

	const entity = await fetchEntity(properties.entityId);
	if (!entity) {
		return;
	}

	const providerName = await resolveEntityProviderName(entity);
	if (providerName !== "TMDB") {
		return;
	}

	const tmdbId = typeof entity.externalId === "string" ? entity.externalId : null;
	if (!tmdbId) {
		return;
	}

	for (const integration of matchingIntegrations) {
		await pushMovieToRadarr(integration, tmdbId);
	}
});
