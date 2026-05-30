import { describe, expect, it } from "bun:test";

import {
	countEntityTranslations,
	createAuthenticatedClient,
	deleteGlobalEntityByProvenance,
	enqueueEntityImport,
	findBuiltinSchemaBySlug,
	getBuiltinEntitySchemaId,
	getEntity,
	getEntityTranslationRow,
	getProviderIds,
	pollEntityUntilTranslationStatus,
	pollEntityImportResult,
	seedPopulatedProviderEntity,
	seedPopulatedTmdbEntity,
	seedPopulatedTmdbMovie,
	setUserProviderLanguage,
} from "../fixtures";
import { assertCondition, assertPresent } from "../test-support/assertions";

const CANONICAL_LANGUAGE = "en-US";

describe("GET /entities/:entityId — translation overlay", () => {
	it("fetches a localized overlay on a miss, then shares it across users", async () => {
		const { client: clientA, userId: userIdA } = await createAuthenticatedClient();
		const movie = await seedPopulatedTmdbMovie(clientA, {
			externalId: "550",
			name: "Canonical Fight Club",
		});

		await setUserProviderLanguage({ userId: userIdA, source: "tmdb", preferredLanguage: "es-ES" });

		const firstRead = await getEntity(clientA, movie.id);
		expect(firstRead.translationStatus).toBe("pending");
		expect(firstRead.name).toBe("Canonical Fight Club");

		const localizedRead = await pollEntityUntilTranslationStatus(clientA, movie.id, "ready", {
			timeoutMs: 90_000,
		});
		expect(localizedRead.name).not.toBe("Canonical Fight Club");
		expect(localizedRead.name.length).toBeGreaterThan(0);

		const { client: clientB, userId: userIdB } = await createAuthenticatedClient();
		await setUserProviderLanguage({ userId: userIdB, source: "tmdb", preferredLanguage: "es-ES" });

		const sharedRead = await getEntity(clientB, movie.id);
		expect(sharedRead.translationStatus).toBe("ready");
		expect(sharedRead.name).toBe(localizedRead.name);
		expect(await countEntityTranslations(movie.id)).toBe(1);
	}, 120_000);

	it("fetches localized TMDB person and movie-group overlays and shares them", async () => {
		const { client: clientA, userId: userIdA } = await createAuthenticatedClient();
		const person = await seedPopulatedTmdbEntity(clientA, {
			externalId: "31",
			schemaSlug: "person",
			name: "Canonical Tom Hanks",
			properties: { description: "Canonical English biography of Tom Hanks." },
		});
		const movieGroup = await seedPopulatedTmdbEntity(clientA, {
			externalId: "10",
			schemaSlug: "movie-group",
			name: "Canonical Star Wars",
			properties: { description: "Canonical English overview of Star Wars." },
		});

		await setUserProviderLanguage({ userId: userIdA, source: "tmdb", preferredLanguage: "es-ES" });

		const firstPersonRead = await getEntity(clientA, person.id);
		expect(firstPersonRead.translationStatus).toBe("pending");
		expect(firstPersonRead.properties.description).toBe(
			"Canonical English biography of Tom Hanks.",
		);

		const firstMovieGroupRead = await getEntity(clientA, movieGroup.id);
		expect(firstMovieGroupRead.translationStatus).toBe("pending");
		expect(firstMovieGroupRead.name).toBe("Canonical Star Wars");

		const localizedPersonRead = await pollEntityUntilTranslationStatus(
			clientA,
			person.id,
			"ready",
			{ timeoutMs: 90_000 },
		);
		const localizedPersonDescription = localizedPersonRead.properties.description;
		expect(typeof localizedPersonDescription).toBe("string");
		expect(localizedPersonDescription).not.toBe("Canonical English biography of Tom Hanks.");
		expect(String(localizedPersonDescription).length).toBeGreaterThan(0);

		const localizedMovieGroupRead = await pollEntityUntilTranslationStatus(
			clientA,
			movieGroup.id,
			"ready",
			{ timeoutMs: 90_000 },
		);
		expect(localizedMovieGroupRead.name).not.toBe("Canonical Star Wars");
		expect(localizedMovieGroupRead.name.length).toBeGreaterThan(0);

		const { client: clientB, userId: userIdB } = await createAuthenticatedClient();
		await setUserProviderLanguage({ userId: userIdB, source: "tmdb", preferredLanguage: "es-ES" });

		const sharedPersonRead = await getEntity(clientB, person.id);
		expect(sharedPersonRead.translationStatus).toBe("ready");
		expect(sharedPersonRead.properties.description).toBe(
			localizedPersonRead.properties.description,
		);

		const sharedMovieGroupRead = await getEntity(clientB, movieGroup.id);
		expect(sharedMovieGroupRead.translationStatus).toBe("ready");
		expect(sharedMovieGroupRead.name).toBe(localizedMovieGroupRead.name);
		expect(await countEntityTranslations(person.id)).toBe(1);
		expect(await countEntityTranslations(movieGroup.id)).toBe(1);
	}, 180_000);

	it("fetches localized TMDB show, season, and episode overlays independently", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { schema: showSchema } = await findBuiltinSchemaBySlug(client, "show");
		const showScriptId = showSchema.providers.find(
			(provider) => provider.name === "TMDB",
		)?.scriptId;
		assertPresent(showScriptId, "TMDB show provider script not found");
		const seasonSchemaId = await getBuiltinEntitySchemaId("show-season");
		const episodeSchemaId = await getBuiltinEntitySchemaId("show-episode");

		const show = await seedPopulatedTmdbEntity(client, {
			externalId: "1399",
			schemaSlug: "show",
			name: "Canonical Game of Thrones",
			properties: { description: "Canonical English show overview." },
		});
		const season = await seedPopulatedTmdbEntity(client, {
			externalId: "3624",
			schemaSlug: "show-season",
			name: "Canonical Season 1",
			sandboxScriptId: showScriptId,
			entitySchemaId: seasonSchemaId,
			properties: {
				seasonNumber: 1,
				releaseDate: "2011-04-17",
				parentShowExternalId: "1399",
				description: "Canonical English season overview.",
			},
		});
		const episode = await seedPopulatedTmdbEntity(client, {
			externalId: "63056",
			schemaSlug: "show-episode",
			sandboxScriptId: showScriptId,
			entitySchemaId: episodeSchemaId,
			name: "Canonical Winter Is Coming",
			properties: {
				runtime: 62,
				seasonNumber: 1,
				episodeNumber: 1,
				publishDate: "2011-04-17",
				parentShowExternalId: "1399",
				description: "Canonical English episode overview.",
			},
		});

		await setUserProviderLanguage({ userId, source: "tmdb", preferredLanguage: "es-ES" });

		const firstShowRead = await getEntity(client, show.id);
		expect(firstShowRead.translationStatus).toBe("pending");
		expect(firstShowRead.name).toBe("Canonical Game of Thrones");

		const firstSeasonRead = await getEntity(client, season.id);
		expect(firstSeasonRead.translationStatus).toBe("pending");
		expect(firstSeasonRead.name).toBe("Canonical Season 1");

		const firstEpisodeRead = await getEntity(client, episode.id);
		expect(firstEpisodeRead.translationStatus).toBe("pending");
		expect(firstEpisodeRead.name).toBe("Canonical Winter Is Coming");

		const [localizedShowRead, localizedSeasonRead, localizedEpisodeRead] = await Promise.all([
			pollEntityUntilTranslationStatus(client, show.id, "ready", { timeoutMs: 90_000 }),
			pollEntityUntilTranslationStatus(client, season.id, "ready", { timeoutMs: 90_000 }),
			pollEntityUntilTranslationStatus(client, episode.id, "ready", { timeoutMs: 90_000 }),
		]);

		expect(localizedShowRead.name).not.toBe("Canonical Game of Thrones");
		expect(localizedShowRead.properties.description).not.toBe("Canonical English show overview.");
		expect(localizedSeasonRead.name).not.toBe("Canonical Season 1");
		expect(localizedSeasonRead.properties.description).not.toBe(
			"Canonical English season overview.",
		);
		expect(localizedEpisodeRead.name).not.toBe("Canonical Winter Is Coming");
		expect(localizedEpisodeRead.properties.description).not.toBe(
			"Canonical English episode overview.",
		);
		expect(await countEntityTranslations(show.id)).toBe(1);
		expect(await countEntityTranslations(season.id)).toBe(1);
		expect(await countEntityTranslations(episode.id)).toBe(1);
	}, 180_000);

	it("fetches Anilist title-mode overlays while details stay canonical", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "anime");
		const anilistScriptId = schema.providers.find(
			(provider) => provider.name === "Anilist",
		)?.scriptId;
		assertPresent(anilistScriptId, "Anilist anime provider script not found");

		await deleteGlobalEntityByProvenance({
			externalId: "5114",
			entitySchemaId: schema.id,
			sandboxScriptId: anilistScriptId,
		});
		await setUserProviderLanguage({ userId, source: "anilist", preferredLanguage: "native" });

		const { jobId } = await enqueueEntityImport(client, {
			externalId: "5114",
			scriptId: anilistScriptId,
			entitySchemaId: schema.id,
		});
		const result = await pollEntityImportResult(client, jobId, { timeoutMs: 45_000 });
		assertCondition(
			result.status === "completed",
			`Expected Anilist import job to complete, got '${result.status}'`,
		);

		const canonicalName = "Fullmetal Alchemist: Brotherhood";
		const entity = result.data;
		expect(entity.name).toBe(canonicalName);

		const firstRead = await getEntity(client, entity.id);
		expect(firstRead.translationStatus).toBe("pending");
		expect(firstRead.name).toBe(canonicalName);

		const localizedRead = await pollEntityUntilTranslationStatus(client, entity.id, "ready", {
			timeoutMs: 90_000,
		});
		expect(localizedRead.name).not.toBe(canonicalName);
		expect(localizedRead.name.length).toBeGreaterThan(0);

		const overlay = await getEntityTranslationRow({ entityId: entity.id, language: "native" });
		expect(overlay?.name).toBe(localizedRead.name);
		expect(overlay?.description ?? null).toBeNull();
		expect(overlay?.image ?? null).toBeNull();
		expect(await countEntityTranslations(entity.id)).toBe(1);
	}, 150_000);

	it("fetches an iTunes podcast episode overlay via its parent podcast reference", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { schema: podcastSchema } = await findBuiltinSchemaBySlug(client, "podcast");
		const itunesScriptId = podcastSchema.providers.find(
			(provider) => provider.name === "iTunes",
		)?.scriptId;
		assertPresent(itunesScriptId, "iTunes podcast provider script not found");
		const episodeSchemaId = await getBuiltinEntitySchemaId("podcast-episode");

		const episode = await seedPopulatedProviderEntity({
			entitySchemaId: episodeSchemaId,
			sandboxScriptId: itunesScriptId,
			externalId: "1000773250098",
			name: "Canonical Serial Episode",
			properties: {
				runtime: 42,
				episodeNumber: 1,
				publishDate: "2026-06-26",
				parentPodcastExternalId: "917918570",
				description: "Canonical English iTunes episode overview.",
			},
		});

		await setUserProviderLanguage({ userId, source: "itunes", preferredLanguage: "es_es" });

		const firstRead = await getEntity(client, episode.id);
		expect(firstRead.translationStatus).toBe("pending");
		expect(firstRead.name).toBe("Canonical Serial Episode");

		const localizedRead = await pollEntityUntilTranslationStatus(client, episode.id, "ready", {
			timeoutMs: 90_000,
		});
		expect(localizedRead.name).not.toBe("Canonical Serial Episode");
		const localizedDescription = localizedRead.properties.description;
		assertCondition(
			typeof localizedDescription === "string",
			"Expected localized iTunes episode description",
		);
		expect(localizedDescription).not.toBe("Canonical English iTunes episode overview.");

		const overlay = await getEntityTranslationRow({ entityId: episode.id, language: "es_es" });
		expect(overlay?.name).toBe(localizedRead.name);
		expect(overlay?.description).toBe(localizedDescription);
		expect(await countEntityTranslations(episode.id)).toBe(1);
	}, 150_000);

	it("fetches a YouTube Music name overlay", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "music");
		const youtubeMusicScriptId = schema.providers.find(
			(provider) => provider.name === "YouTube Music",
		)?.scriptId;
		assertPresent(youtubeMusicScriptId, "YouTube Music provider script not found");

		const music = await seedPopulatedProviderEntity({
			entitySchemaId: schema.id,
			sandboxScriptId: youtubeMusicScriptId,
			externalId: "dQw4w9WgXcQ",
			name: "Canonical YouTube Music Track",
			properties: { description: "Canonical YouTube Music description." },
		});

		await setUserProviderLanguage({ userId, source: "youtube-music", preferredLanguage: "es" });

		const firstRead = await getEntity(client, music.id);
		expect(firstRead.translationStatus).toBe("pending");
		expect(firstRead.name).toBe("Canonical YouTube Music Track");

		const localizedRead = await pollEntityUntilTranslationStatus(client, music.id, "ready", {
			timeoutMs: 90_000,
		});
		expect(localizedRead.name).not.toBe("Canonical YouTube Music Track");

		const overlay = await getEntityTranslationRow({ entityId: music.id, language: "es" });
		expect(overlay?.name).toBe(localizedRead.name);
		expect(overlay?.description ?? null).toBeNull();
		expect(overlay?.image ?? null).toBeNull();
		expect(await countEntityTranslations(music.id)).toBe(1);
	}, 150_000);

	it("fetches localized TVDB movie, person, and episode overlays", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const movieIds = await getProviderIds(client, {
			schemaSlug: "movie",
			providerName: "TVDB",
		});
		const personIds = await getProviderIds(client, {
			schemaSlug: "person",
			providerName: "TVDB",
		});
		const showIds = await getProviderIds(client, {
			schemaSlug: "show",
			providerName: "TVDB",
		});
		const episodeSchemaId = await getBuiltinEntitySchemaId("show-episode");

		const movie = await seedPopulatedProviderEntity({
			externalId: "247",
			name: "Canonical TVDB Fight Club",
			entitySchemaId: movieIds.entitySchemaId,
			sandboxScriptId: movieIds.sandboxScriptId,
			properties: { description: "Canonical English TVDB movie overview." },
		});
		const person = await seedPopulatedProviderEntity({
			externalId: "247858",
			name: "Canonical TVDB Sean Bean",
			entitySchemaId: personIds.entitySchemaId,
			sandboxScriptId: personIds.sandboxScriptId,
			properties: { description: "Canonical English TVDB person biography." },
		});
		const episode = await seedPopulatedProviderEntity({
			externalId: "3254641",
			entitySchemaId: episodeSchemaId,
			sandboxScriptId: showIds.sandboxScriptId,
			name: "Canonical TVDB Winter Is Coming",
			properties: {
				runtime: 61,
				seasonNumber: 1,
				episodeNumber: 1,
				publishDate: "2011-04-17",
				parentShowExternalId: "121361",
				description: "Canonical English TVDB episode overview.",
			},
		});

		await setUserProviderLanguage({ userId, source: "tvdb", preferredLanguage: "spa" });

		const firstMovieRead = await getEntity(client, movie.id);
		expect(firstMovieRead.translationStatus).toBe("pending");
		expect(firstMovieRead.name).toBe("Canonical TVDB Fight Club");

		const firstPersonRead = await getEntity(client, person.id);
		expect(firstPersonRead.translationStatus).toBe("pending");
		expect(firstPersonRead.name).toBe("Canonical TVDB Sean Bean");

		const firstEpisodeRead = await getEntity(client, episode.id);
		expect(firstEpisodeRead.translationStatus).toBe("pending");
		expect(firstEpisodeRead.name).toBe("Canonical TVDB Winter Is Coming");

		const [localizedMovieRead, localizedPersonRead, localizedEpisodeRead] = await Promise.all([
			pollEntityUntilTranslationStatus(client, movie.id, "ready", { timeoutMs: 90_000 }),
			pollEntityUntilTranslationStatus(client, person.id, "ready", { timeoutMs: 90_000 }),
			pollEntityUntilTranslationStatus(client, episode.id, "ready", { timeoutMs: 90_000 }),
		]);

		expect(localizedMovieRead.name).not.toBe("Canonical TVDB Fight Club");
		expect(localizedPersonRead.name).not.toBe("Canonical TVDB Sean Bean");
		expect(localizedEpisodeRead.name).not.toBe("Canonical TVDB Winter Is Coming");
		expect(await countEntityTranslations(movie.id)).toBe(1);
		expect(await countEntityTranslations(person.id)).toBe(1);
		expect(await countEntityTranslations(episode.id)).toBe(1);
	}, 180_000);

	it("negative-caches when the provider has no translation and does not refetch", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const movie = await seedPopulatedTmdbMovie(client, {
			externalId: "238",
			name: "Canonical The Godfather",
		});

		await setUserProviderLanguage({ userId, source: "tmdb", preferredLanguage: "xx" });

		const firstRead = await getEntity(client, movie.id);
		expect(firstRead.translationStatus).toBe("pending");

		const settledRead = await pollEntityUntilTranslationStatus(client, movie.id, "none", {
			timeoutMs: 90_000,
		});
		expect(settledRead.name).toBe("Canonical The Godfather");

		const overlay = await getEntityTranslationRow({ entityId: movie.id, language: "xx" });
		expect(overlay?.name ?? null).toBeNull();
		expect(overlay?.description ?? null).toBeNull();
		expect(overlay?.image ?? null).toBeNull();
		expect(await countEntityTranslations(movie.id)).toBe(1);
	}, 120_000);

	it("renders canonical without fetching when the resolved language is canonical or unset", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const movie = await seedPopulatedTmdbMovie(client, {
			externalId: "278",
			name: "Canonical The Shawshank Redemption",
		});

		await setUserProviderLanguage({
			userId,
			source: "tmdb",
			preferredLanguage: CANONICAL_LANGUAGE,
		});
		const canonicalPreferenceRead = await getEntity(client, movie.id);
		expect(canonicalPreferenceRead.translationStatus).toBe("none");
		expect(canonicalPreferenceRead.name).toBe("Canonical The Shawshank Redemption");
		expect(await countEntityTranslations(movie.id)).toBe(0);

		const { client: noPreferenceClient } = await createAuthenticatedClient();
		const noPreferenceRead = await getEntity(noPreferenceClient, movie.id);
		expect(noPreferenceRead.translationStatus).toBe("none");
		expect(noPreferenceRead.name).toBe("Canonical The Shawshank Redemption");
		expect(await countEntityTranslations(movie.id)).toBe(0);
	});
});
