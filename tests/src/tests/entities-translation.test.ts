import { describe, expect, it } from "bun:test";

import {
	type Client,
	countEntityTranslations,
	createAuthenticatedClient,
	deleteGlobalEntityByProvenance,
	findBuiltinSchemaBySlug,
	getEntity,
	getEntityTranslationRow,
	markEntityPopulated,
	pollEntityUntilTranslationStatus,
	seedMediaEntity,
	setUserProviderLanguage,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

const CANONICAL_LANGUAGE = "en-US";

async function seedPopulatedTmdbEntity(
	client: Client,
	input: {
		name: string;
		externalId: string;
		schemaSlug: string;
		properties: Record<string, unknown>;
	},
) {
	const { schema } = await findBuiltinSchemaBySlug(client, input.schemaSlug);
	const sandboxScriptId = schema.providers.find((provider) => provider.name === "TMDB")?.scriptId;
	assertPresent(sandboxScriptId, `TMDB ${input.schemaSlug} provider script not found`);

	const provenance = { externalId: input.externalId, entitySchemaId: schema.id, sandboxScriptId };
	await deleteGlobalEntityByProvenance(provenance);

	const seeded = await seedMediaEntity({
		image: null,
		userId: null,
		sandboxScriptId,
		name: input.name,
		entitySchemaId: schema.id,
		externalId: input.externalId,
		properties: input.properties,
	});
	await markEntityPopulated(seeded.id);

	return seeded;
}

async function seedPopulatedTmdbMovie(client: Client, input: { externalId: string; name: string }) {
	return seedPopulatedTmdbEntity(client, {
		name: input.name,
		schemaSlug: "movie",
		externalId: input.externalId,
		properties: { description: `Canonical English overview of ${input.name}.` },
	});
}

describe("GET /entities/:entityId — translation overlay", () => {
	it("fetches a localized overlay on a miss, then shares it across users", async () => {
		const { client: clientA, userId: userIdA } = await createAuthenticatedClient();
		const movie = await seedPopulatedTmdbMovie(clientA, {
			externalId: "550",
			name: "Canonical Fight Club",
		});

		await setUserProviderLanguage({ userId: userIdA, source: "tmdb", preferredLanguage: "es-ES" });

		// First read: no overlay yet, so the canonical text is returned immediately
		// with a pending status while the fill runs in the background.
		const firstRead = await getEntity(clientA, movie.id);
		expect(firstRead.translationStatus).toBe("pending");
		expect(firstRead.name).toBe("Canonical Fight Club");

		// Subsequent reads return the merged localized overlay once it is populated.
		const localizedRead = await pollEntityUntilTranslationStatus(clientA, movie.id, "ready", {
			timeoutMs: 90_000,
		});
		expect(localizedRead.name).not.toBe("Canonical Fight Club");
		expect(localizedRead.name.length).toBeGreaterThan(0);

		// A second user preferring the same language reuses the single shared overlay
		// without triggering another fetch.
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

	it("negative-caches when the provider has no translation and does not refetch", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const movie = await seedPopulatedTmdbMovie(client, {
			externalId: "238",
			name: "Canonical The Godfather",
		});

		// "xx" is not a real language, so TMDB never has a translation for it: the
		// fill writes an all-null negative-cache row that resolves to status none.
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

		// Preference equal to the canonical language: render canonical, no row, no fetch.
		await setUserProviderLanguage({
			userId,
			source: "tmdb",
			preferredLanguage: CANONICAL_LANGUAGE,
		});
		const canonicalPreferenceRead = await getEntity(client, movie.id);
		expect(canonicalPreferenceRead.translationStatus).toBe("none");
		expect(canonicalPreferenceRead.name).toBe("Canonical The Shawshank Redemption");
		expect(await countEntityTranslations(movie.id)).toBe(0);

		// A different user with no preference for the provider: same canonical result.
		const { client: noPreferenceClient } = await createAuthenticatedClient();
		const noPreferenceRead = await getEntity(noPreferenceClient, movie.id);
		expect(noPreferenceRead.translationStatus).toBe("none");
		expect(noPreferenceRead.name).toBe("Canonical The Shawshank Redemption");
		expect(await countEntityTranslations(movie.id)).toBe(0);
	});
});
